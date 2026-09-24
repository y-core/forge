import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { WranglerConfig } from "../../cf/types";
import { stripJsonc } from "../../cli/jsonc";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { parseImports, resolveSpecifier } from "./namespace-graph-parse";
import { collectFiles, isTestSource, unresolvedSourceEntries } from "./source-scan";
import type { DevBoundaryCheckConfig } from "./types";

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

const SCANNED = (name: string): boolean => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !isTestSource(name);

/** The filename convention a development entry point is derived from. */
const DEV_ENTRY = /\.dev\.tsx?$/;

/** Whether `file` is a development entry point — by the convention, or by an explicit listing. @public */
export function isDevEntry(file: string, devEntries: readonly string[] = []): boolean {
  return DEV_ENTRY.test(file) || devEntries.includes(file);
}

/** Whether `file` lives in one of this repository's own dev-only trees. */
function isDevOnly(file: string, devOnlyDirs: readonly string[]): boolean {
  return devOnlyDirs.some((dir) => file === dir || file.startsWith(`${dir}/`));
}

// `resolveSpecifier` strips the extension, because the graph check it serves needs only the directory.
// A finding has to name a file, so the extension — and the `mod.ts` a directory specifier means — is put back.
function resolveModuleFile(root: string, modulePath: string): string | null {
  const candidates = [...MODULE_EXTENSIONS.map((ext) => `${modulePath}${ext}`), ...MODULE_EXTENSIONS.map((ext) => `${modulePath}/mod${ext}`)];
  return candidates.find((candidate) => existsSync(resolve(root, candidate))) ?? null;
}

/** The manifest of an installed dependency, found by walking `node_modules` upward from `root`. */
function manifestPath(root: string, packageName: string): string | null {
  let current = resolve(root);
  for (;;) {
    const candidate = resolve(current, "node_modules", packageName, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The specifiers a dependency's `forge.devOnly` declaration forbids, as a consumer would spell them. @public */
export function devOnlySpecifiers(root: string, packageName: string): readonly string[] | null {
  const path = manifestPath(root, packageName);
  if (path === null) return null;
  try {
    const manifest = JSON.parse(readFileSync(path, "utf-8")) as { forge?: { devOnly?: readonly string[] } };
    const declared = manifest.forge?.devOnly;
    if (declared === undefined) return null;
    return declared.map((subpath) => `${packageName}${subpath.slice(1)}`);
  } catch {
    return null;
  }
}

/** Whether `specifier` is one of the forbidden published ones; a trailing `/*` matches a subtree. */
function isForbidden(specifier: string, forbidden: readonly string[]): boolean {
  return forbidden.some((entry) => (entry.endsWith("/*") ? specifier.startsWith(entry.slice(0, -1)) : specifier === entry));
}

/** Rule A: the deployed entry the Worker config names must not be a development one. */
function judgeMain(config: DevBoundaryCheckConfig): Finding[] {
  const workerConfig = config.workerConfig === undefined ? "wrangler.jsonc" : config.workerConfig;
  if (workerConfig === null) return [];

  const workerPath = resolve(config.root, workerConfig);
  if (!existsSync(workerPath)) {
    return [
      fail(`\`${workerConfig}\` not found`, {
        file: workerConfig,
        detail: ["name the Worker config, or pass `workerConfig: null` for a repository that deploys none"],
      }),
    ];
  }

  let parsed: WranglerConfig;
  try {
    parsed = JSON.parse(stripJsonc(readFileSync(workerPath, "utf-8"))) as WranglerConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [fail(`\`${workerConfig}\` is not parseable: ${message}`, { file: workerConfig })];
  }

  const main = parsed.main;
  if (main === undefined) {
    return [
      fail("`main` is unstated, and an unstated entry point is one no check can hold to the production/development split", {
        file: workerConfig,
        detail: ['state "main" as the production entry point'],
      }),
    ];
  }

  const normalized = main.startsWith("./") ? main.slice(2) : main;
  if (!isDevEntry(normalized, config.devEntries)) return [];
  return [
    fail(`\`main\` names the development entry \`${normalized}\``, {
      file: workerConfig,
      detail: [
        "a development entry mints the allowances production must not hold, so deploying one puts every relaxation in the deployed bundle",
        "point `main` at the production entry, and keep the development one to `wrangler dev`",
      ],
    }),
  ];
}

/** Rule B: nothing imports a development entry, which has no importer outside the test set. */
function judgeEntryImport(config: DevBoundaryCheckConfig, file: string, specifier: string, line: number): Finding | null {
  const module = resolveSpecifier(file, specifier);
  if (module === null) return null;
  const target = resolveModuleFile(config.root, module) ?? module;
  if (!isDevEntry(target, config.devEntries)) return null;
  return fail(`development entry imported — \`${specifier}\` resolves to \`${target}\``, {
    file,
    line,
    detail: [
      "a development entry is reached by `wrangler dev` alone; an import makes it reachable from whatever imports this file",
      "move the shared part into a module both entries import, and drop this import",
    ],
  });
}

/** Rule C: only a development entry may import a dev-only module. */
function judgeDevOnlyImport(
  config: DevBoundaryCheckConfig,
  forbidden: readonly string[],
  file: string,
  specifier: string,
  line: number,
): Finding | null {
  const module = resolveSpecifier(file, specifier);
  const crossing =
    module === null
      ? isForbidden(specifier, forbidden)
        ? specifier
        : null
      : isDevOnly(module, config.devOnlyDirs ?? [])
        ? (resolveModuleFile(config.root, module) ?? module)
        : null;
  if (crossing === null) return null;

  return fail(`dev-only module imported — \`${specifier}\` resolves to \`${crossing}\``, {
    file,
    line,
    detail: [
      "a dev-only module is not deployable: minting an allowance, or faking a binding, is something only a development entry may do",
      "import it from a `*.dev.ts` entry, or import the type alone — a type is erased and puts nothing in the bundle",
    ],
  });
}

/** Fails when a production module names a development entry, a dev-only module, or is itself deployed as `main`. @public */
export function checkDevBoundary(config: DevBoundaryCheckConfig): CheckResult {
  const sources = config.sources ?? ["src"];
  const files = sources.flatMap((dir) => collectFiles(config.root, dir, SCANNED));
  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no source`, "dev-boundary");
  const unresolved = unresolvedSourceEntries(config.root, sources);
  if (unresolved.length > 0) return checkResult(unresolved, "");

  const findings: Finding[] = [...judgeMain(config)];

  // Derived from the filename, so a listing that only restates the convention is a second spelling
  // of the same fact and can disagree with it.
  for (const entry of config.devEntries ?? []) {
    if (!DEV_ENTRY.test(entry)) continue;
    findings.push(
      fail(`\`devEntries\` lists \`${entry}\`, which the \`*.dev.ts\` convention already derives`, {
        detail: ["remove the entry — the convention is what the check reads, and a listing beside it can only disagree"],
      }),
    );
  }

  const forbidden = (config.packages ?? []).flatMap((packageName) => {
    const declared = devOnlySpecifiers(config.root, packageName);
    if (declared !== null) return declared;
    findings.push(
      fail(`\`${packageName}\` declares no \`forge.devOnly\` subpaths`, {
        detail: [
          "the check reads the forbidden list from the installed dependency's manifest, so an unreadable one silently forbids nothing",
          `install \`${packageName}\`, or drop it from \`packages\``,
        ],
      }),
    );
    return [];
  });

  let judged = 0;
  for (const file of files) {
    if (isDevOnly(file, config.devOnlyDirs ?? [])) continue;
    judged++;
    const devEntry = isDevEntry(file, config.devEntries);
    for (const ref of parseImports(readFileSync(resolve(config.root, file), "utf-8"))) {
      const entryFinding = judgeEntryImport(config, file, ref.specifier, ref.line);
      if (entryFinding !== null) findings.push(entryFinding);
      // A type import is erased at emit, and the allowance *type* is what a production option names;
      // only minting one is the crossing.
      if (devEntry || ref.kind === "type") continue;
      const devOnlyFinding = judgeDevOnlyImport(config, forbidden, file, ref.specifier, ref.line);
      if (devOnlyFinding !== null) findings.push(devOnlyFinding);
    }
  }

  return checkResult(findings, `${judged} deployable sources mint no development allowance`);
}
