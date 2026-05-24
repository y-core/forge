import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
  const defRe = /export\s+(?:function|const|class)\s+([A-Za-z_$]\w*)/g;
  for (const match of source.matchAll(defRe)) {
    values.push(match[1]);
  }

  return { values, hasExportStar, hasTypeExports };
}

const pkgExports = (pkg as any).exports as Record<string, { import?: string; types?: string } | string>;
let failed = false;

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

if (failed) {
  process.exit(1);
}
console.log("\nAll exports verified.");
