import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { DEV_CONDITION, WRANGLER_CONDITIONS } from "../../cf/dev/conditions";
import { checkResult, fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import { hasEsbuild } from "./bundle";
import { DEV_MODULE, isForbidden, manifestPath } from "./dev-boundary";
import type { BundleMetafile, DevBundleCheckConfig } from "./types";
import { isRecord, readWorkerConfig } from "./worker-config";

type Esbuild = typeof import("esbuild");

/** The worker config keys that change what wrangler bundles, which this check does not reproduce. */
const UNMODELLED = ["alias", "build", "define", "rules"] as const;

/** The compatibility flags under which wrangler resolves a bare Node built-in through a polyfill this check does not reproduce. */
const UNMODELLED_FLAGS = ["nodejs_compat", "nodejs_compat_v2"] as const;

function unmodelledFlags(flags: unknown, key: string): string[] {
  if (!Array.isArray(flags)) return [];
  return UNMODELLED_FLAGS.filter((flag) => flags.includes(flag)).map((flag) => `\`${key}\` carries \`${flag}\``);
}

function unmodelledKeys(block: Record<string, unknown>, prefix: string): string[] {
  return UNMODELLED.filter((key) => block[key] !== undefined).map((key) => `\`${prefix}${key}\` is set`);
}

/** Every setting in the worker config that changes what wrangler bundles, phrased as the clause a refusal opens with. */
function unmodelledSettings(config: Record<string, unknown>): string[] {
  const keys = unmodelledKeys(config, "");
  const top = unmodelledFlags(config.compatibility_flags, "compatibility_flags");
  const environments = isRecord(config.env) ? Object.entries(config.env) : [];
  const scoped = environments.flatMap(([name, environment]) =>
    isRecord(environment)
      ? [...unmodelledKeys(environment, `env.${name}.`), ...unmodelledFlags(environment.compatibility_flags, `env.${name}.compatibility_flags`)]
      : [],
  );
  return [...keys, ...top, ...scoped];
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** esbuild from the project, or from wrangler's own dependency when the project lists none. */
async function loadEsbuild(root: string): Promise<Esbuild | null> {
  if (hasEsbuild()) return (await import("esbuild")) as Esbuild;
  try {
    const wrangler = createRequire(resolve(root, "package.json")).resolve("wrangler");
    return (await import(pathToFileURL(createRequire(wrangler).resolve("esbuild")).href)) as Esbuild;
  } catch {
    return null;
  }
}

/** The esbuild options that bundle `entry` the way wrangler bundles a module Worker under `conditions`. @internal */
export function workerBuildOptions(root: string, entry: string, conditions: readonly string[] = WRANGLER_CONDITIONS) {
  return {
    entryPoints: [resolve(root, entry)],
    absWorkingDir: resolve(root),
    bundle: true,
    format: "esm",
    platform: "neutral",
    conditions: [...conditions],
    mainFields: ["browser", "module", "main"],
    external: ["cloudflare:*", "node:*"],
    // Wrangler's default module rules: these extensions import as text or bytes rather than as code.
    loader: { ".txt": "text", ".html": "text", ".sql": "text", ".bin": "binary", ".wasm": "binary" },
    metafile: true,
    write: false,
    logLevel: "silent",
  } satisfies Parameters<Esbuild["build"]>[0];
}

/** Bundles `entry` with the resolution wrangler applies to a module Worker, and returns the metafile. @public */
export async function bundleWorker(root: string, entry: string, conditions: readonly string[] = WRANGLER_CONDITIONS): Promise<BundleMetafile> {
  const esbuild = await loadEsbuild(root);
  if (esbuild === null) throw new Error("esbuild is not installed, and wrangler's own copy could not be resolved");
  const result = await esbuild.build(workerBuildOptions(root, entry, conditions));
  return result.metafile;
}

interface DeclaringManifest {
  exports?: Record<string, string | { import?: string }>;
  forge?: { devOnly?: readonly string[] };
}

function readManifest(path: string): DeclaringManifest | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as DeclaringManifest;
  } catch {
    return null;
  }
}

/** The absolute directories a declaring dependency publishes its dev-only subpaths from. */
function forbiddenDirs(root: string, packageName: string): { dirs: string[]; findings: Finding[] } {
  const path = manifestPath(root, packageName);
  const manifest = path === null ? null : readManifest(path);
  const devOnly = manifest?.forge?.devOnly;
  if (path === null || devOnly === undefined) {
    return {
      dirs: [],
      findings: [
        fail(`\`${packageName}\` declares no \`forge.devOnly\` subpaths`, {
          detail: [
            "the check reads the forbidden directories from the installed dependency's manifest, so an unreadable one forbids nothing",
            `install \`${packageName}\`, or drop it from \`packages\``,
          ],
        }),
      ],
    };
  }

  const packageDir = dirname(path);
  const sourceRoot = real(resolve(packageDir, "src"));
  const dirs: string[] = [];
  const findings: Finding[] = [];
  for (const [subpath, target] of Object.entries(manifest?.exports ?? {})) {
    if (!isForbidden(subpath, devOnly)) continue;
    const file = typeof target === "string" ? target : target.import;
    if (file === undefined) continue;
    const dir = real(resolve(packageDir, dirname(file)));
    if (dir === sourceRoot) {
      findings.push(
        fail(`\`${packageName}\` publishes the dev-only \`${subpath}\` from its source root`, {
          detail: ["forbidding that directory would forbid the whole package, so the subpath has to live in a directory of its own"],
        }),
      );
      continue;
    }
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return { dirs, findings };
}

/** The deployed bundle's inputs that contributed bytes, as absolute real paths beside the spelling esbuild reported. */
function bundledInputs(root: string, metafile: BundleMetafile): { reported: string; path: string }[] {
  const seen = new Map<string, string>();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      // A tree-shaken module is still listed, with nothing in the output; a `ns:` prefix is no file at all.
      if (bytesInOutput === 0 || /^[a-z][\w-]*:/i.test(input)) continue;
      if (!seen.has(input)) seen.set(input, real(resolve(root, input)));
    }
  }
  return [...seen].map(([reported, path]) => ({ reported, path }));
}

/** A finding when the ambient `WRANGLER_BUILD_CONDITIONS` would resolve every `#relax` import to its development module. */
function ambientDevCondition(env: Readonly<Record<string, string | undefined>>): Finding[] {
  const declared = (env.WRANGLER_BUILD_CONDITIONS ?? "").split(",").map((condition) => condition.trim());
  if (!declared.includes(DEV_CONDITION)) return [];
  return [
    fail(`\`WRANGLER_BUILD_CONDITIONS\` carries \`${DEV_CONDITION}\`, so a deploy from this shell bundles every development module`, {
      detail: [
        `\`forge cf dev\` sets \`${DEV_CONDITION}\` in its child process only, so an exported variable that carries it is one a deploy inherits`,
        `unset \`WRANGLER_BUILD_CONDITIONS\`, or drop \`${DEV_CONDITION}\` from it`,
      ],
    }),
  ];
}

/** Fails when the bundle of the deployed `main` contains a `*.dev.ts` module, or one from a dev-only directory a dependency publishes. @public */
export async function checkDevBundle(config: DevBundleCheckConfig): Promise<CheckResult> {
  const ambient = ambientDevCondition(config.env ?? process.env);
  if (ambient.length > 0) return checkResult(ambient, "");

  const workerConfig = config.workerConfig ?? "wrangler.jsonc";
  const read = readWorkerConfig(config.root, workerConfig, "dev-bundle");
  if (!("config" in read)) return read;

  const unmodelled = unmodelledSettings(read.config);
  if (unmodelled.length > 0) {
    return checkResult(
      unmodelled.map((setting) =>
        fail(`${setting}, and the dev-bundle check does not model it`, {
          file: workerConfig,
          detail: ["the check bundles `main` itself, so a bundle wrangler shapes differently is one it would judge wrongly"],
        }),
      ),
      "",
    );
  }

  const main = read.config.main;
  if (main === undefined) {
    return checkResult([fail("`main` is unstated, so there is no deployed bundle to judge", { file: workerConfig })], "");
  }

  const findings: Finding[] = [];
  const forbidden: string[] = [];
  for (const packageName of config.packages ?? []) {
    const declared = forbiddenDirs(config.root, packageName);
    forbidden.push(...declared.dirs);
    findings.push(...declared.findings);
  }

  let metafile: BundleMetafile;
  try {
    metafile = await (config.bundler ?? bundleWorker)(config.root, main);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return checkResult([...findings, fail(`\`${main}\` did not bundle: ${message}`, { file: workerConfig })], "");
  }

  const inputs = bundledInputs(config.root, metafile);
  for (const { reported, path } of inputs) {
    const inDevOnly = forbidden.some((dir) => path === dir || path.startsWith(`${dir}/`));
    if (!inDevOnly && !DEV_MODULE.test(path)) continue;
    findings.push(
      fail(`development code in the deployed bundle — \`${reported}\``, {
        file: reported,
        detail: [
          `\`${main}\` reaches it, so every deployment ships it`,
          "find the import that pulls it in and move the development part into a `*.dev.ts` module",
        ],
      }),
    );
  }

  return checkResult(findings, `${main} bundles ${inputs.length} modules, none of them development code`);
}
