import { resolve, dirname } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = (pkg as { name: string }).name;
const PUBLISHED_FILES = new Set((pkg as { files?: string[] }).files ?? []);

// Only ./ui/client imports DOM globals (document, window, MutationObserver) and
// cannot be imported. Static parsing still runs; runtime import is skipped.
const BROWSER_ONLY = new Set(["./ui/client", "./ui/client/htmx"]);

function parseBarrelExports(filePath: string): { values: string[]; hasExportStar: boolean; hasTypeExports: boolean } {
  const source = readFileSync(filePath, "utf-8").replace(/\/\/.*$/gm, "");

  const hasExportStar = /export\s+\*\s+from\s+/.test(source);
  const values: string[] = [];
  let hasTypeExports = false;

  // Phase 1: export { ... } blocks (with optional leading `type` keyword)
  // The `s` flag lets [^}]+ span newlines for multi-line brace groups.
  const blockRe = /export\s+(type\s+)?\{([^}]+)\}/gs;
  for (const match of source.matchAll(blockRe)) {
    if (match[1]) {
      hasTypeExports = true; // type-only block — erased at runtime
      continue;
    }
    for (const part of match[2].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("type ")) continue; // inline type marker
      const asIdx = trimmed.indexOf(" as ");
      const name = asIdx >= 0 ? trimmed.slice(asIdx + 4).trim() : trimmed;
      if (name) values.push(name);
    }
  }

  // Phase 2: inline export definitions
  const defRe = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$]\w*)/g;
  for (const match of source.matchAll(defRe)) {
    values.push(match[1]);
  }

  return { values, hasExportStar, hasTypeExports };
}

/**
 * Collects every identifier a barrel makes available — runtime values, re-exported types, and
 * both sides of an `as` alias — so a `@public` source symbol can be matched whether the barrel
 * re-exports it directly or under a new name.
 */
function parseBarrelExportNames(filePath: string): Set<string> {
  const source = readFileSync(filePath, "utf-8").replace(/\/\/.*$/gm, "");
  const names = new Set<string>();

  const blockRe = /export\s+(?:type\s+)?\{([^}]+)\}/gs;
  for (const match of source.matchAll(blockRe)) {
    for (const part of match[1].split(",")) {
      let trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("type ")) trimmed = trimmed.slice(5).trim();
      const asIdx = trimmed.indexOf(" as ");
      if (asIdx >= 0) {
        names.add(trimmed.slice(0, asIdx).trim());
        names.add(trimmed.slice(asIdx + 4).trim());
      } else {
        names.add(trimmed);
      }
    }
  }

  const defRe = /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$]\w*)/g;
  for (const match of source.matchAll(defRe)) names.add(match[1]);

  return names;
}

/** Extracts the exported identifier(s) declared on a single line, or `null` if none. */
function exportNamesFromLine(line: string): string[] | null {
  const decl = line.match(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$]\w*)/);
  if (decl) return [decl[1]];

  const block = line.match(/export\s+(?:type\s+)?\{([^}]+)\}/);
  if (block) {
    const names = block[1]
      .split(",")
      .map((part) => {
        let trimmed = part.trim();
        if (trimmed.startsWith("type ")) trimmed = trimmed.slice(5).trim();
        const asIdx = trimmed.indexOf(" as ");
        return asIdx >= 0 ? trimmed.slice(asIdx + 4).trim() : trimmed;
      })
      .filter(Boolean);
    return names.length > 0 ? names : null;
  }
  return null;
}

/**
 * Finds every `@public`-tagged exported symbol in a source file. A `@public` JSDoc tag binds to
 * the next `export` declaration within a short lookahead (skipping intervening `biome-ignore`
 * comment lines), matching the codebase convention of tagging the line above the export.
 */
function findPublicSymbols(filePath: string): string[] {
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("@public")) continue;
    for (let j = i; j < Math.min(lines.length, i + 9); j++) {
      const names = exportNamesFromLine(lines[j]);
      if (names) {
        found.push(...names);
        break;
      }
    }
  }
  return found;
}

/**
 * Recursively collects `.ts`/`.tsx` source files owned by `ownerDir`, stopping at any nested
 * directory that is itself a registered barrel (a separate namespace validated on its own).
 * Excludes test files and the barrel file itself.
 */
function collectOwnedSourceFiles(ownerDir: string, barrelDirs: Set<string>, barrelFile: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(ownerDir, { withFileTypes: true })) {
    const full = resolve(ownerDir, entry.name);
    if (entry.isDirectory()) {
      if (barrelDirs.has(full)) continue; // separate namespace — validated independently
      out.push(...collectOwnedSourceFiles(full, barrelDirs, barrelFile));
    } else if (entry.isFile()) {
      if (full === barrelFile) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

const pkgExports = (pkg as any).exports as Record<string, { import?: string; types?: string } | string>;
let failed = false;

// Pre-compute the directory of every `mod.ts` barrel so the source→barrel scan can stop at
// sub-namespace boundaries (e.g. `./logging` must not pull in `./logging/http` symbols).
const barrelDirs = new Set<string>();
for (const entry of Object.values(pkgExports)) {
  const rawPath = typeof entry === "string" ? entry : (entry.import ?? entry.types);
  if (rawPath?.endsWith("/mod.ts")) barrelDirs.add(dirname(resolve(ROOT, rawPath)));
}

function isPublished(rawPath: string): boolean {
  const normalizedPath = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;
  for (const entry of PUBLISHED_FILES) {
    if (entry.startsWith("!")) continue;
    const normalized = entry.endsWith("/") ? entry : `${entry}/`;
    if (normalizedPath === entry || normalizedPath.startsWith(normalized)) {
      return true;
    }
  }
  return false;
}

for (const [specifier, entry] of Object.entries(pkgExports)) {
  const rawPath = typeof entry === "string" ? entry : (entry.import ?? entry.types);
  if (!rawPath) {
    console.error(`FAIL ${specifier}: no import path in package.json`);
    failed = true;
    continue;
  }

  const filePath = resolve(ROOT, rawPath);
  if (!existsSync(filePath)) {
    console.error(`FAIL ${specifier}: barrel file not found at ${rawPath}`);
    failed = true;
    continue;
  }

  if (!isPublished(rawPath)) {
    console.error(`FAIL ${specifier}: ${rawPath} is not covered by package.json files`);
    failed = true;
    continue;
  }

  const { values, hasExportStar, hasTypeExports } = parseBarrelExports(filePath);

  if (hasExportStar) {
    console.error(`FAIL ${specifier}: contains banned \`export *\` — use explicit named exports`);
    failed = true;
    continue;
  }

  if (values.length === 0) {
    if (hasTypeExports) {
      console.log(`  ok ${specifier} (type-only barrel — no runtime exports)`);
      continue;
    }
    console.error(`FAIL ${specifier}: no value exports found in barrel`);
    failed = true;
    continue;
  }

  if (BROWSER_ONLY.has(specifier)) {
    console.log(`  ok ${specifier} (browser-only — ${values.length} exports parsed)`);
    continue;
  }

  try {
    const consumerSpecifier = specifier === "."
      ? PACKAGE_NAME
      : `${PACKAGE_NAME}${specifier.slice(1)}`;
    const mod = await import(consumerSpecifier);
    const missing = values.filter((name) => !(name in mod));
    if (missing.length > 0) {
      console.error(`FAIL ${specifier}: missing from runtime: ${missing.join(", ")}`);
      failed = true;
    } else {
      console.log(`  ok ${specifier} (${values.length} exports verified)`);
    }
  } catch (err) {
    console.error(`FAIL ${specifier}: import failed — ${err}`);
    failed = true;
  }
}

// Source → barrel: every `@public`-tagged symbol in a namespace's source must be re-exported by
// that namespace's barrel. Catches a public symbol that was never added to the barrel — the
// inverse of the barrel→runtime check above, which only sees symbols already in the barrel.
console.log("\nChecking @public source symbols are exported from their barrel...");
for (const [specifier, entry] of Object.entries(pkgExports)) {
  const rawPath = typeof entry === "string" ? entry : (entry.import ?? entry.types);
  if (!rawPath?.endsWith("/mod.ts")) continue; // single-file modules are their own barrel

  const barrelFile = resolve(ROOT, rawPath);
  const ownerDir = dirname(barrelFile);
  if (!existsSync(barrelFile)) continue; // already reported by the loop above

  const barrelNames = parseBarrelExportNames(barrelFile);
  const sourceFiles = collectOwnedSourceFiles(ownerDir, barrelDirs, barrelFile);

  const missing = new Set<string>();
  for (const file of sourceFiles) {
    for (const symbol of findPublicSymbols(file)) {
      if (!barrelNames.has(symbol)) missing.add(symbol);
    }
  }

  if (missing.size > 0) {
    console.error(`FAIL ${specifier}: @public symbols missing from barrel: ${[...missing].sort().join(", ")}`);
    failed = true;
  } else {
    console.log(`  ok ${specifier} (@public symbols all exported)`);
  }
}

if (failed) {
  process.exit(1);
}
console.log("\nAll exports verified.");
