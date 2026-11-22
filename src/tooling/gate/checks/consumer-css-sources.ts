import { existsSync, readFileSync } from "node:fs";
import { dirname, posix, relative, resolve, sep } from "node:path";

import { loadConfig } from "../../assets/config";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { findClassDeclarations } from "./css-parse";
import { manifestPath } from "./dev-boundary";
import { parseImports, resolveSpecifier } from "./namespace-graph-parse";
import { collectFiles, isTestSource, resolveModuleFile, unresolvedSourceEntries } from "./source-scan";
import type { ConsumerCssSourcesCheckConfig, ExportsMap, InstalledPackage, MarkupScan, ScannedModule } from "./types";

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

const SCANNED = (name: string): boolean => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !isTestSource(name);

const SOURCES_EXPORT = /^\.\/(.+)\/sources\.css$/;

/** The installed package `packageName` resolves to from `root`, or `null` when it is not installed. @internal */
export function readInstalledPackage(root: string, packageName: string): InstalledPackage | null {
  const path = manifestPath(root, packageName);
  if (path === null) return null;
  const manifest = JSON.parse(readFileSync(path, "utf-8")) as { exports?: ExportsMap };
  return { dir: dirname(path), exports: manifest.exports ?? {} };
}

function stripDotSlash(target: string): string {
  return target.startsWith("./") ? target.slice(2) : target;
}

/** The source file a published subpath resolves to under the `bun` condition, else the default `import` one — never a `node` bundle. @internal */
export function sourceEntry(exports: ExportsMap, subpath: string): string | null {
  const value = exports[`./${subpath}`];
  if (value === undefined) return null;
  const target = typeof value === "string" ? value : (value.bun ?? value.import);
  return target === undefined ? null : stripDotSlash(target);
}

/** Each namespace whose `sources.css` the package exports, to the package-relative directory that sheet sits in. @internal */
export function sourcesDirectories(exports: ExportsMap): Map<string, string> {
  const directories = new Map<string, string>();
  for (const key of Object.keys(exports)) {
    const namespace = SOURCES_EXPORT.exec(key)?.[1];
    const target = namespace === undefined ? null : sourceEntry(exports, `${namespace}/sources.css`);
    if (namespace !== undefined && target !== null) directories.set(namespace, posix.dirname(target));
  }
  return directories;
}

function owningNamespace(file: string, directories: ReadonlyMap<string, string>): string | null {
  let owner: string | null = null;
  let depth = -1;
  for (const [namespace, dir] of directories) {
    if (!file.startsWith(`${dir}/`) || dir.length <= depth) continue;
    owner = namespace;
    depth = dir.length;
  }
  return owner;
}

function resolveInPackage(pkg: InstalledPackage, target: string, scan: MarkupScan): string | null {
  const known = scan.resolved.get(target);
  if (known !== undefined) return known;
  const module = resolveModuleFile(pkg.dir, target);
  scan.resolved.set(target, module);
  return module;
}

function scanModule(pkg: InstalledPackage, file: string, directories: ReadonlyMap<string, string>, scan: MarkupScan): ScannedModule {
  const source = readFileSync(resolve(pkg.dir, file), "utf-8");
  const imports = parseImports(source).flatMap((ref) => {
    const target = ref.kind === "type" ? null : resolveSpecifier(file, ref.specifier);
    const module = target === null || target.startsWith("../") ? null : resolveInPackage(pkg, target, scan);
    return module === null ? [] : [module];
  });
  const owner = owningNamespace(file, directories);
  return { imports, markupNamespace: owner !== null && findClassDeclarations(source).length > 0 ? owner : null };
}

/** A fresh scan for one run's markup walks, which must all share one `directories`. @internal */
export function createMarkupScan(): MarkupScan {
  return { modules: new Map(), resolved: new Map() };
}

/** The namespaces with a `sources.css` whose class-declaring files `entry` reaches through in-package value imports. @internal */
export function markupNamespacesReached(
  pkg: InstalledPackage,
  entry: string,
  directories: ReadonlyMap<string, string>,
  scan: MarkupScan = createMarkupScan(),
): Set<string> {
  const reached = new Set<string>();
  const seen = new Set<string>();
  const pending = existsSync(resolve(pkg.dir, entry)) ? [entry] : [];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const module = scan.modules.get(file) ?? scanModule(pkg, file, directories, scan);
    scan.modules.set(file, module);
    if (module.markupNamespace !== null) reached.add(module.markupNamespace);
    pending.push(...module.imports);
  }
  return reached;
}

/** The `@import` line that pulls a namespace's `sources.css` into a stylesheet. @internal */
export function sourcesImportLine(packageName: string, namespace: string): string {
  return `@import "${packageName}/${namespace}/sources.css";`;
}

const CSS_IMPORT = /@import\s+["']([^"']+)["']/g;

function reachableImports(path: string, seen: Set<string> = new Set()): Set<string> {
  const specifiers = new Set<string>();
  if (seen.has(path) || !existsSync(path)) return specifiers;
  seen.add(path);
  const live = readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, specifier = ""] of live.matchAll(CSS_IMPORT)) {
    specifiers.add(specifier);
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
    for (const nested of reachableImports(resolve(dirname(path), specifier), seen)) specifiers.add(nested);
  }
  return specifiers;
}

function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}

/** Fails each `sources.css` import of a namespace whose markup the app's value imports reach that no `css[].input` of the assets config reaches. @public */
export async function checkConsumerCssSources(config: ConsumerCssSourcesCheckConfig): Promise<CheckResult> {
  const { root, packageName } = config;
  const sources = config.sources ?? ["src"];
  const files = sources.flatMap((dir) => collectFiles(root, dir, SCANNED));
  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no source`, "consumer-css-sources");
  const unresolved = unresolvedSourceEntries(root, sources);
  if (unresolved.length > 0) return checkResult(unresolved, "");

  const installed = readInstalledPackage(root, packageName);
  if (installed === null) {
    return checkResult(
      [
        fail(`\`${packageName}\` is not installed, so which of its namespaces ship a \`sources.css\` cannot be read`, {
          detail: [`install \`${packageName}\``],
        }),
      ],
      "",
    );
  }

  const prefix = `${packageName}/`;
  const directories = sourcesDirectories(installed.exports);
  const reachedByEntry = new Map<string, ReadonlySet<string>>();
  const scan = createMarkupScan();
  const required = new Map<string, string[]>();
  for (const file of files) {
    for (const ref of parseImports(readFileSync(resolve(root, file), "utf-8"))) {
      if (ref.kind === "type" || !ref.specifier.startsWith(prefix)) continue;
      const entry = sourceEntry(installed.exports, ref.specifier.slice(prefix.length));
      if (entry === null) continue;
      const reached = reachedByEntry.get(entry) ?? markupNamespacesReached(installed, entry, directories, scan);
      reachedByEntry.set(entry, reached);
      for (const namespace of reached) {
        required.set(namespace, [...(required.get(namespace) ?? []), `${file}:${ref.line} imports \`${ref.specifier}\``]);
      }
    }
  }

  const resolved = await loadConfig({ root, configPath: config.assetConfig });
  const inputs = resolved.css.map((build) => toPosix(relative(root, build.input)));

  const findings: Finding[] = [];
  const read: string[] = [];
  const carried = new Set<string>();
  for (const input of inputs) {
    const path = resolve(root, input);
    if (!existsSync(path)) {
      findings.push(fail(`the CSS entry \`${input}\` named by \`${config.assetConfig}\` does not exist`, { file: config.assetConfig }));
      continue;
    }
    read.push(input);
    for (const specifier of reachableImports(path)) carried.add(specifier);
  }

  const [entry] = read;
  for (const [namespace, sites] of [...required].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const specifier = `${packageName}/${namespace}/sources.css`;
    if (entry === undefined || carried.has(specifier)) continue;
    findings.push(
      fail(`no CSS entry imports \`${specifier}\`, so the \`${namespace}\` markup the app renders ships unstyled`, {
        file: entry,
        detail: [`add: ${sourcesImportLine(packageName, namespace)}`, ...sites],
      }),
    );
  }

  return checkResult(
    findings,
    `${inputs.length} CSS entries together import the sources.css of all ${required.size} ${packageName} namespaces the app's source reaches`,
  );
}
