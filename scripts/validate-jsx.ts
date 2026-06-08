import { resolve, dirname } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");

const PRAGMA_RUNTIME = "@jsxRuntime automatic";
const PRAGMA_SOURCE = "@jsxImportSource @y-core/forge";

function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsx(full));
    } else if (entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

const files = collectTsx(SRC);
let failed = false;

for (const file of files) {
  const src = readFileSync(file, "utf-8");
  const missingRuntime = !src.includes(PRAGMA_RUNTIME);
  const missingSource = !src.includes(PRAGMA_SOURCE);
  if (missingRuntime || missingSource) {
    const rel = file.slice(ROOT.length + 1);
    console.error(`FAIL ${rel}`);
    if (missingRuntime) console.error(`  missing: /** @jsxRuntime automatic */`);
    if (missingSource) console.error(`  missing: /** @jsxImportSource @y-core/forge */`);
    failed = true;
  }
}

if (failed) {
  console.error("\nEach shipped .tsx file must carry both JSX pragma lines.");
  process.exit(1);
}

console.log(`  ok ${files.length} .tsx files carry both JSX pragmas.`);
