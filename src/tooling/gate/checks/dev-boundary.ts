import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { DEV_CONDITION } from "../../cf/dev/conditions";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { parseImports, resolveSpecifier } from "./namespace-graph-parse";
import { deployTarget, importsCondition, readPackageImports } from "./package-imports";
import { collectFiles, isTestSource, resolveModuleFile, unresolvedSourceEntries } from "./source-scan";
import type { DevBoundaryCheckConfig, PackageImports } from "./types";
import { readWorkerConfig } from "./worker-config";

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

const SCANNED = (name: string): boolean => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !isTestSource(name);

/** The filename suffix that marks a development module — an entry point, or a relaxation beside its concern. @internal */
export const DEV_MODULE = /\.dev\.tsx?$/;

/** Whether `file` is a development module by its `*.dev.ts` suffix. @public */
export function isDevModule(file: string): boolean {
  return DEV_MODULE.test(file);
}

/** Whether `file` lives in one of this repository's own dev-only trees. @internal */
export function isDevOnly(file: string, devOnlyDirs: readonly string[]): boolean {
  return devOnlyDirs.some((dir) => file === dir || file.startsWith(`${dir}/`));
}

/** The manifest of an installed dependency, found by walking `node_modules` upward from `root`. @internal */
export function manifestPath(root: string, packageName: string): string | null {
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

/** Whether `specifier` is one of the forbidden published ones; a trailing `/*` matches a subtree. @internal */
export function isForbidden(specifier: string, forbidden: readonly string[]): boolean {
  return forbidden.some((entry) => (entry.endsWith("/*") ? specifier.startsWith(entry.slice(0, -1)) : specifier === entry));
}

/** Rule A: the deployed entry the Worker config names must not be a development one. */
function judgeMain(config: DevBoundaryCheckConfig): Finding[] {
  const workerConfig = config.workerConfig === undefined ? "wrangler.jsonc" : config.workerConfig;
  if (workerConfig === null) return [];

  const read = readWorkerConfig(config.root, workerConfig, "dev-boundary", [
    "name the Worker config, or pass `workerConfig: null` for a repository that deploys none",
  ]);
  if (!("config" in read)) return [...read.findings];

  const main = read.config.main;
  if (main === undefined) {
    return [
      fail("`main` is unstated, and an unstated entry point is one no check can hold to the production/development split", {
        file: workerConfig,
        detail: ['state "main" as the production entry point'],
      }),
    ];
  }

  const normalized = main.startsWith("./") ? main.slice(2) : main;
  if (!isDevModule(normalized)) return [];
  return [
    fail(`\`main\` names the development entry \`${normalized}\``, {
      file: workerConfig,
      detail: [
        "a development entry holds code production must not run, so deploying one puts it in the deployed bundle",
        "point `main` at the production entry, and keep the development one to `wrangler dev`",
      ],
    }),
  ];
}

/** Rule B, on the manifest: no `imports` entry resolves to a development module in the deployed bundle. */
function judgeImportsMap(imports: PackageImports): Finding[] {
  return Object.keys(imports).flatMap((key) => {
    const target = deployTarget(imports, key);
    if (target === null || !isDevModule(target)) return [];
    return [
      fail(`\`imports\` entry \`${key}\` deploys the development module \`${target}\``, {
        file: "package.json",
        detail: [
          "the condition the deployed bundle resolves `imports` under picks a `*.dev.ts` module, so every importer of the entry deploys it",
          "point that condition at a module without the suffix, and keep the development one behind the `forge-dev` condition, which only `forge cf dev` sets",
        ],
      }),
    ];
  });
}

/** Rule D, on the manifest: no `imports` entry but the app's relaxation alias routes through `forge-dev`. */
function judgeRelaxAlias(imports: PackageImports, alias: string): Finding[] {
  return Object.keys(imports).flatMap((key) => {
    if (key === alias || !importsCondition(imports, key, DEV_CONDITION)) return [];
    return [
      fail(`\`imports\` entry \`${key}\` routes \`${DEV_CONDITION}\` through a second relaxation alias`, {
        file: "package.json",
        detail: [
          "the app has one relaxation alias, so what a development build loosens is auditable in one file pair",
          `move the export onto the \`${alias}\` pair and delete this entry`,
        ],
      }),
    ];
  });
}

/** Rule B: no production module imports a development one, not even for a type. */
function judgeDevModuleImport(
  config: DevBoundaryCheckConfig,
  imports: PackageImports,
  file: string,
  specifier: string,
  line: number,
): Finding | null {
  const module = resolveSpecifier(file, specifier) ?? deployTarget(imports, specifier);
  if (module === null) return null;
  const target = resolveModuleFile(config.root, module) ?? module;
  if (!isDevModule(target)) return null;
  return fail(`development module imported — \`${specifier}\` resolves to \`${target}\``, {
    file,
    line,
    detail: [
      "a `*.dev.ts` module is reached from the development entry alone; an import makes it reachable from whatever imports this file",
      "import it from a `*.dev.ts` module instead, and keep what production needs in a module without the suffix",
    ],
  });
}

/** Rule C: only a development module may import a dev-only one. */
function judgeDevOnlyImport(
  config: DevBoundaryCheckConfig,
  imports: PackageImports,
  forbidden: readonly string[],
  file: string,
  specifier: string,
  line: number,
): Finding | null {
  const module = resolveSpecifier(file, specifier) ?? deployTarget(imports, specifier);
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
      "a dev-only module is not deployable: faking a binding, or relaxing a guard, is something only development code may do",
      "import it from a `*.dev.ts` module, or import the type alone — a type is erased and puts nothing in the bundle",
    ],
  });
}

/** Fails when a production module imports a `*.dev.ts` module or a dev-only one, or `main` is a development module. @public */
export function checkDevBoundary(config: DevBoundaryCheckConfig): CheckResult {
  const sources = config.sources ?? ["src"];
  const files = sources.flatMap((dir) => collectFiles(config.root, dir, SCANNED));
  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no source`, "dev-boundary");
  const unresolved = unresolvedSourceEntries(config.root, sources);
  if (unresolved.length > 0) return checkResult(unresolved, "");

  const imports = readPackageImports(config.root);
  const findings: Finding[] = [
    ...judgeMain(config),
    ...judgeImportsMap(imports),
    ...(config.relaxAlias === undefined ? [] : judgeRelaxAlias(imports, config.relaxAlias)),
  ];

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
    if (isDevModule(file) || isDevOnly(file, config.devOnlyDirs ?? [])) continue;
    judged++;
    const source = readFileSync(resolve(config.root, file), "utf-8");
    for (const ref of parseImports(source)) {
      const devModuleFinding = judgeDevModuleImport(config, imports, file, ref.specifier, ref.line);
      if (devModuleFinding !== null) findings.push(devModuleFinding);
      // A type import is erased at emit, so it puts nothing dev-only in the deployed bundle.
      if (ref.kind === "type") continue;
      const devOnlyFinding = judgeDevOnlyImport(config, imports, forbidden, file, ref.specifier, ref.line);
      if (devOnlyFinding !== null) findings.push(devOnlyFinding);
    }
  }

  return checkResult(findings, `${judged} deployable sources reach no development code`);
}
