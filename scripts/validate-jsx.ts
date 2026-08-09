import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findSlotClobbers } from "./jsx-parse";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");

const PRAGMA_RUNTIME = "@jsxRuntime automatic";
const PRAGMA_SOURCE = "@jsxImportSource @y-core/forge/jsx";

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
  const clobbers = findSlotClobbers(src);
  if (missingRuntime || missingSource || clobbers.length > 0) {
    const rel = file.slice(ROOT.length + 1);
    console.error(`FAIL ${rel}`);
    if (missingRuntime) console.error(`  missing: /** @jsxRuntime automatic */`);
    if (missingSource) console.error(`  missing: /** @jsxImportSource @y-core/forge/jsx */`);
    for (const { line, tag, slot, spread } of clobbers) {
      console.error(
        `  line ${line}: \`<${tag}>\` has a literal \`data-slot='${slot}'\` before \`{...${spread}}\` — the spread wins and the token is lost; destructure \`"data-slot": inherited\` and write \`data-slot={slotToken("${slot}", inherited)}\``,
      );
    }
    failed = true;
  }
}

if (failed) {
  console.error(
    "\nEach shipped .tsx file must carry both JSX pragma lines, and must merge every `data-slot` it writes rather than leaving it exposed to a later spread.",
  );
  process.exit(1);
}

console.log(`  ok ${files.length} .tsx files carry both JSX pragmas and no clobberable \`data-slot\`.`);
