import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { type CheckResult, checkResult, type Finding, fail } from "../finding";
import { findPublicSymbols, parseBarrelExportNames, parseBarrelExports } from "./barrel-parse";

/** A package's `exports` map as it appears in `package.json`. */
export type ExportsMap = Record<string, { import?: string; types?: string } | string>;

/** What the exports check needs to know about the project. @public */
export interface ExportsCheckConfig {
  /** Application root. Every path is resolved against it, and reported relative to it. */
  root: string;
  /** The package name consumers import under, e.g. `@y-core/forge`. */
  packageName: string;
  /** The `exports` map, verbatim from `package.json`. */
  exports: ExportsMap;
  /** The `files` array, verbatim from `package.json`. */
  files: readonly string[];
  /** Directory scanned for source barrels, relative to `root`. Defaults to `"src"`. */
  sourceDir?: string;
  /** Subpaths whose runtime import is skipped because loading them touches DOM globals. */
  browserOnly?: readonly string[];
  /** Subpaths that intentionally export no value, because they mutate globals or register once. */
  sideEffectOnly?: readonly string[];
  /** Barrels that are intentionally unpublished because every symbol is `@internal`. */
  sealedInternal?: readonly string[];
  /** Directories of non-module assets whose every member must resolve for a consumer. */
  assetDirs?: readonly { dir: string; extension: string }[];
}

interface PatternEntry {
  specifier: string;
  keyPrefix: string;
  keySuffix: string;
  targetPrefix: string;
  targetSuffix: string;
}

/** The import target of one `exports` entry, in either the string or conditional form. */
function targetOf(entry: ExportsMap[string]): string | undefined {
  return typeof entry === "string" ? entry : (entry.import ?? entry.types);
}

/** Strip a leading `./` so map targets and repo-relative paths compare directly. */
function bare(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

/** Split every subpath pattern in the map into its four fixed parts. @public */
export function parseSubpathPatterns(map: ExportsMap): { patterns: PatternEntry[]; findings: Finding[] } {
  const patterns: PatternEntry[] = [];
  const findings: Finding[] = [];

  for (const [specifier, entry] of Object.entries(map)) {
    if (!specifier.includes("*")) continue;
    const rawPath = targetOf(entry);
    if (rawPath === undefined) continue;

    const [keyPrefix = "", ...keyRest] = specifier.split("*");
    const [targetPrefix = "", ...targetRest] = rawPath.split("*");
    const keySuffix = keyRest[0];
    const targetSuffix = targetRest[0];

    if (keyRest.length !== 1 || targetRest.length !== 1 || keySuffix === undefined || targetSuffix === undefined) {
      findings.push(fail(`${specifier}: a subpath pattern may contain exactly one \`*\` in the key and one in the target`));
      continue;
    }
    patterns.push({ specifier, keyPrefix, keySuffix, targetPrefix, targetSuffix });
  }

  return { patterns, findings };
}

/** Whether `relPath` falls inside a `files[]` entry. @public */
export function isPublished(relPath: string, files: readonly string[]): boolean {
  const normalizedPath = bare(relPath);
  for (const entry of files) {
    if (entry.startsWith("!")) continue;
    const asDir = entry.endsWith("/") ? entry : `${entry}/`;
    if (normalizedPath === entry || normalizedPath.startsWith(asDir)) return true;
  }
  return false;
}

/** The consumer specifier a pattern member is reachable under — the `*` substituted into the key. */
function specifierForMember(entry: PatternEntry, relPath: string, packageName: string): string {
  const prefix = bare(entry.targetPrefix);
  const star = relPath.slice(prefix.length, relPath.length - entry.targetSuffix.length);
  return `${packageName}${entry.keyPrefix.slice(1)}${star}${entry.keySuffix}`;
}

/** Whether a pattern's target covers `relPath`. */
function covers(entry: PatternEntry, relPath: string): boolean {
  const prefix = bare(entry.targetPrefix);
  return relPath.startsWith(prefix) && relPath.endsWith(entry.targetSuffix) && relPath.length >= prefix.length + entry.targetSuffix.length;
}

/** Every file on disk a pattern's target matches, repo-relative and sorted. */
function expandPattern(root: string, entry: PatternEntry): string[] {
  const prefix = bare(entry.targetPrefix);
  const staticDir = prefix.slice(0, prefix.lastIndexOf("/") + 1);
  const base = resolve(root, staticDir);
  if (!existsSync(base)) return [];

  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        const rel = relative(root, full);
        if (covers(entry, rel)) out.push(rel);
      }
    }
  };
  walk(base);
  return out.sort();
}

/** Source files a barrel owns, stopping at any nested directory that is itself a registered barrel. */
function collectOwnedSourceFiles(ownerDir: string, barrelDirs: Set<string>, barrelFile: string, ownTargets: Set<string>): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(ownerDir, { withFileTypes: true })) {
    const full = resolve(ownerDir, entry.name);
    if (entry.isDirectory()) {
      if (barrelDirs.has(full)) continue;
      out.push(...collectOwnedSourceFiles(full, barrelDirs, barrelFile, ownTargets));
    } else if (entry.isFile()) {
      if (full === barrelFile || ownTargets.has(full)) continue;
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

/** Every `mod.ts` under `dir`, repo-relative. */
function collectModFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectModFiles(root, full));
    else if (entry.isFile() && entry.name === "mod.ts") out.push(relative(root, full));
  }
  return out;
}

/** Runs all five passes verifying the `exports` map against the source tree. @public */
export async function checkExports(config: ExportsCheckConfig): Promise<CheckResult> {
  const { root, packageName, exports: map, files } = config;
  const sourceDir = config.sourceDir ?? "src";
  const browserOnly = new Set(config.browserOnly ?? []);
  const sideEffectOnly = new Set(config.sideEffectOnly ?? []);
  const sealedInternal = new Set(config.sealedInternal ?? []);

  const { patterns, findings } = parseSubpathPatterns(map);

  const barrelDirs = new Set<string>();
  const ownExportTargetFiles = new Set<string>();
  const exportedTargets = new Set<string>();
  for (const [specifier, entry] of Object.entries(map)) {
    const rawPath = targetOf(entry);
    if (rawPath === undefined || specifier.includes("*")) continue;
    exportedTargets.add(bare(rawPath));
    if (rawPath.endsWith("/mod.ts")) barrelDirs.add(dirname(resolve(root, rawPath)));
    else ownExportTargetFiles.add(resolve(root, rawPath));
  }

  let checked = 0;

  for (const [specifier, entry] of Object.entries(map)) {
    const rawPath = targetOf(entry);
    if (rawPath === undefined) {
      findings.push(fail(`${specifier}: no import path in package.json`));
      continue;
    }

    const pattern = patterns.find((candidate) => candidate.specifier === specifier);
    if (pattern) {
      const members = expandPattern(root, pattern);
      if (members.length === 0) {
        findings.push(fail(`${specifier}: pattern matches no file on disk — nothing is reachable under it`));
        continue;
      }
      for (const member of members) {
        if (/\.tsx?$/.test(member)) {
          findings.push(fail(`${specifier}: expands to the module ${member} — patterns are for assets; give a module its own key`));
          continue;
        }
        if (!isPublished(`./${member}`, files)) {
          findings.push(fail(`${specifier}: ${member} is not covered by package.json files`, { file: member }));
          continue;
        }
        const consumerSpecifier = specifierForMember(pattern, member, packageName);
        try {
          import.meta.resolve(consumerSpecifier);
        } catch (err) {
          findings.push(fail(`${specifier}: ${member} is published but unresolvable as ${consumerSpecifier} — ${err}`, { file: member }));
        }
      }
      checked++;
      continue;
    }

    const filePath = resolve(root, rawPath);
    if (!existsSync(filePath)) {
      findings.push(fail(`${specifier}: barrel file not found at ${rawPath}`));
      continue;
    }
    if (!isPublished(rawPath, files)) {
      findings.push(fail(`${specifier}: ${rawPath} is not covered by package.json files`));
      continue;
    }

    if (!/\.tsx?$/.test(rawPath)) {
      const consumerSpecifier = `${packageName}${specifier.slice(1)}`;
      try {
        import.meta.resolve(consumerSpecifier);
      } catch (err) {
        findings.push(fail(`${specifier}: published but unresolvable as ${consumerSpecifier} — ${err}`));
      }
      checked++;
      continue;
    }

    const { values, hasExportStar, hasTypeExports } = parseBarrelExports(readFileSync(filePath, "utf-8"));

    if (hasExportStar) {
      findings.push(
        fail(
          `${specifier}: contains a banned star re-export (\`export *\`, \`export * as ns\`, or \`export type *\`) — use explicit named exports`,
        ),
      );
      continue;
    }

    if (values.length === 0) {
      if (!hasTypeExports && !browserOnly.has(specifier) && !sideEffectOnly.has(specifier)) {
        findings.push(fail(`${specifier}: no value exports found in barrel`));
      }
      checked++;
      continue;
    }

    if (browserOnly.has(specifier) || sideEffectOnly.has(specifier)) {
      checked++;
      continue;
    }

    try {
      const consumerSpecifier = specifier === "." ? packageName : `${packageName}${specifier.slice(1)}`;
      const mod = (await import(consumerSpecifier)) as Record<string, unknown>;
      const missing = values.filter((name) => !(name in mod));
      if (missing.length > 0) findings.push(fail(`${specifier}: missing from runtime: ${missing.join(", ")}`));
    } catch (err) {
      findings.push(fail(`${specifier}: import failed — ${err}`));
    }
    checked++;
  }

  for (const [specifier, entry] of Object.entries(map)) {
    const rawPath = targetOf(entry);
    if (rawPath?.endsWith("/mod.ts") !== true) continue;

    const barrelFile = resolve(root, rawPath);
    if (!existsSync(barrelFile)) continue;

    const barrelNames = parseBarrelExportNames(readFileSync(barrelFile, "utf-8"));
    const missing = new Set<string>();
    for (const file of collectOwnedSourceFiles(dirname(barrelFile), barrelDirs, barrelFile, ownExportTargetFiles)) {
      for (const symbol of findPublicSymbols(readFileSync(file, "utf-8"))) {
        if (!barrelNames.has(symbol)) missing.add(symbol);
      }
    }
    if (missing.size > 0) findings.push(fail(`${specifier}: @public symbols missing from barrel: ${[...missing].sort().join(", ")}`));
  }

  for (const modFile of collectModFiles(root, resolve(root, sourceDir))) {
    if (exportedTargets.has(modFile) || patterns.some((p) => covers(p, modFile)) || sealedInternal.has(modFile)) continue;
    findings.push(fail("barrel is not a package.json exports target and not on the sealed-internal allowlist", { file: modFile }));
  }

  for (const entry of files) {
    if (entry.startsWith("!")) continue;
    if (!existsSync(resolve(root, entry))) findings.push(fail(`files[]: ${entry} does not exist on disk`));
  }

  for (const { dir, extension } of config.assetDirs ?? []) {
    const base = resolve(root, dir);
    if (!existsSync(base)) {
      findings.push(fail(`assetDirs: ${dir} does not exist on disk`));
      continue;
    }
    for (const entry of readdirSync(base).sort()) {
      if (!entry.endsWith(extension)) continue;
      const relPath = `${dir}/${entry}`;

      let consumerSpecifier: string | undefined;
      if (exportedTargets.has(relPath)) {
        const key = Object.entries(map).find(([spec, value]) => {
          const target = targetOf(value);
          return !spec.includes("*") && target !== undefined && bare(target) === relPath;
        })?.[0];
        if (key !== undefined) consumerSpecifier = `${packageName}${key.slice(1)}`;
      } else {
        const pattern = patterns.find((candidate) => covers(candidate, relPath));
        if (pattern) consumerSpecifier = specifierForMember(pattern, relPath, packageName);
      }

      if (consumerSpecifier === undefined) {
        findings.push(fail("no exports key or pattern covers it — consumers cannot import it", { file: relPath }));
        continue;
      }
      try {
        import.meta.resolve(consumerSpecifier);
      } catch (err) {
        findings.push(fail(`covered by the exports map but unresolvable as ${consumerSpecifier} — ${err}`, { file: relPath }));
      }
    }
  }

  return checkResult(findings, `${checked} export subpaths resolve, and every barrel, files[] entry and asset is reachable.`);
}
