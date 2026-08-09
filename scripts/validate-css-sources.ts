import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");
const UI = resolve(SRC, "ui");
const CSS_DIR = resolve(UI, "assets/css");

// Directories under `src/ui/` that are deliberately **not** `@source`-scanned, each with the reason
// it emits no utility class. An entry is a claim about the directory's contents, so pass B re-checks
// every one of them on each run — an unchecked opt-out is how a directory quietly starts carrying
// classes again.
const CLASS_FREE = new Map([
  ["assets", "sprite and glyph data — no markup, no class strings"],
  ["client", "mount controllers; the markup they operate on is the consumer's"],
  ["server", "SSR helpers that delegate to core/ components for all markup"],
]);

const SKIP_FILE = (name: string) => name.endsWith(".test.ts") || name.endsWith(".test.tsx") || name.endsWith(".browser.ts");

let failed = false;

// ── Pass A (disk → config): every directory under `src/ui/` is scanned or registered ──────────────
//
// The reverse direction is the whole point. A forward check ("does every `@source` path exist?")
// passes forever while a *new* directory goes unscanned — which is exactly how `contracts/` shipped a
// class-string literal that no consumer's Tailwind build ever saw. Asking disk to justify itself
// against the config means a new directory fails until someone classifies it.
//
// The `src/ui/` bound on the sweep is a **policy**, not the reach of a relative path: forge.css owes
// consumers the classes its own components emit, because importing `ui` is the statement that they
// will be rendered. A namespace whose markup is opt-in owes them a documented `@source` requirement
// instead — pass C. So an `@source` that escapes `src/ui/` fails here rather than being ignored.
console.log("Checking every src/ui directory is @source-scanned or registered class-free...");

const scanned: string[] = [];
for (const entry of readdirSync(CSS_DIR).sort()) {
  if (!entry.endsWith(".css")) continue;
  const css = readFileSync(resolve(CSS_DIR, entry), "utf-8");
  // `@source not "…"` is an exclusion, not coverage — skip it.
  for (const match of css.matchAll(/@source\s+(not\s+)?["']([^"']+)["']/g)) {
    if (match[1]) continue;
    // Group 2 is mandatory in the pattern, so a match always carries it.
    const source = match[2];
    if (source === undefined) continue;
    const abs = resolve(CSS_DIR, source);
    if (abs !== UI && !abs.startsWith(UI + sep)) {
      console.error(`FAIL src/ui/assets/css/${entry}: @source "${source}" resolves outside src/ui/ (${relative(ROOT, abs)})`);
      console.error(`  forge.css scans ui/ and nothing else. A namespace outside it documents its own`);
      console.error(`  @source requirement in its README for the consuming app to honour instead.`);
      failed = true;
      continue;
    }
    scanned.push(abs);
  }
}

const isScanned = (dir: string) => scanned.some((s) => dir === s || dir.startsWith(s + sep));

for (const entry of readdirSync(UI, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const abs = resolve(UI, entry.name);
  if (isScanned(abs)) {
    console.log(`  ok src/ui/${entry.name} (@source-scanned)`);
  } else if (CLASS_FREE.has(entry.name)) {
    console.log(`  ok src/ui/${entry.name} (class-free: ${CLASS_FREE.get(entry.name)})`);
  } else {
    console.error(`FAIL src/ui/${entry.name}: no @source path in src/ui/assets/css/ covers it, and it is not registered in CLASS_FREE`);
    console.error(`  Add \`@source "../../${entry.name}";\` to forge.css if its files declare utility classes,`);
    console.error(`  or add it to CLASS_FREE in scripts/validate-css-sources.ts with the reason it cannot.`);
    failed = true;
  }
}

// ── Pass B (registered directories → literals): no class string hides behind an opt-out ───────────
//
// Pass A trusts `CLASS_FREE` indefinitely; this is what keeps that trust earned.
console.log("\nChecking no class-free directory declares utility classes...");

// A fixed vocabulary of Tailwind roots. Matching is deliberately shallow — the goal is to notice a
// class *string*, not to validate Tailwind syntax.
const BARE = new Set(["flex", "grid", "hidden", "absolute", "relative", "static", "sticky", "fixed"]);
const FAMILY =
  /^(inline-|px-|py-|pt-|pb-|pl-|pr-|p-|mx-|my-|mt-|mb-|ml-|mr-|m-|w-|h-|size-|gap-|text-|bg-|border|rounded|opacity-|shadow-|z-|ring-|leading-|tracking-|space-)/;
// `hover:`, `focus-visible:`, `aria-disabled:` … — a variant prefix is itself a strong signal, and
// the shape excludes a URL (`https://…` carries `//` and a dot).
const VARIANT = /^(?:[a-z][a-z0-9-]*:)+[a-z0-9[]/;

function isAnchor(token: string): boolean {
  if (token.includes("/") || token.includes(".")) return false;
  const base = token.replace(/^(?:[a-z][a-z0-9-]*:)+/, "");
  return BARE.has(base) || FAMILY.test(base) || VARIANT.test(token);
}

// Comments are stripped **before** literals are extracted, and that ordering is load-bearing rather
// than tidy: TSDoc prose in these directories is full of words the vocabulary matches ("does this
// fit", "which item has focus"), and every false positive a naive detector produced came from a
// comment. Stripping is textual, so a `/*` inside a string literal could mis-slice — the worst case
// is a false positive a human reads, which is the right direction for a gate to be wrong in.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, "");
}

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !SKIP_FILE(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Two anchors, not one: a lone `flex` appears in prose and in a fixture; two together is a class
// string. This is the line that separates `MENU_ITEM_CLASS` from an incidental match — and the line
// that keeps `"grid"`, an `aria-haspopup` union member in `src/jsx/types.ts`, from reading as one.
function declaredClasses(file: string): { literal: string; anchors: string[] }[] {
  const source = stripComments(readFileSync(file, "utf-8"));
  const out: { literal: string; anchors: string[] }[] = [];
  for (const match of source.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
    const literal = match[1] ?? match[2] ?? match[3] ?? "";
    const anchors = literal.split(/\s+/).filter(isAnchor);
    if (anchors.length >= 2) out.push({ literal, anchors });
  }
  return out;
}

const suspects: string[] = [];
for (const name of CLASS_FREE.keys()) {
  const abs = resolve(UI, name);
  try {
    if (statSync(abs).isDirectory()) suspects.push(...collectSources(abs));
  } catch {
    console.error(`FAIL CLASS_FREE lists src/ui/${name}, which does not exist on disk`);
    failed = true;
  }
}
// Loose modules at the `src/ui/` root are covered by no `@source` path either.
for (const entry of readdirSync(UI, { withFileTypes: true })) {
  if (entry.isFile() && /\.tsx?$/.test(entry.name) && !SKIP_FILE(entry.name)) {
    suspects.push(resolve(UI, entry.name));
  }
}

let hiddenDeclarations = 0;
for (const file of suspects.sort()) {
  const rel = relative(ROOT, file);
  for (const { literal, anchors } of declaredClasses(file)) {
    console.error(`FAIL ${rel}: string literal declares utility classes — ${anchors.join(" ")}`);
    console.error(`  in: ${literal.length > 120 ? literal.slice(0, 120) + "…" : literal}`);
    console.error(`  Either move the declaration into an @source-scanned directory, or drop this`);
    console.error(`  directory from CLASS_FREE and give it an @source path in forge.css.`);
    hiddenDeclarations++;
    failed = true;
  }
}
if (hiddenDeclarations === 0) {
  console.log(`  ok ${suspects.length} class-free modules declare none.`);
}

// ── Pass C (disk → docs): a class-bearing namespace outside `ui/` documents its own requirement ───
//
// Pass A's bound makes these namespaces' classes the consuming app's to scan, which is only a
// workable contract if the app can find that out. So the requirement is that the namespace's own
// README says so, at the place someone adopting the surface is already reading. `src/ui/` has no
// business cataloguing its siblings and a prose inventory drifts, so the set is derived from disk:
// a namespace that starts rendering classed markup fails here until it is documented.
console.log("\nChecking class-bearing namespaces outside src/ui document their @source requirement...");

for (const entry of readdirSync(SRC, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || entry.name === "ui") continue;
  const abs = resolve(SRC, entry.name);
  const declaring = collectSources(abs)
    .sort()
    .filter((file) => declaredClasses(file).length > 0);
  if (declaring.length === 0) continue;

  const readme = resolve(abs, "README.md");
  if (existsSync(readme) && readFileSync(readme, "utf-8").includes("@source")) {
    console.log(`  ok src/${entry.name} (${declaring.length} class-bearing file(s), @source documented)`);
  } else {
    console.error(`FAIL src/${entry.name}: renders utility classes, but its README.md never mentions @source`);
    for (const file of declaring) console.error(`  ${relative(ROOT, file)}`);
    console.error(`  forge.css scans ui/ only, so these classes are the consuming app's to scan.`);
    console.error(`  Say so in src/${entry.name}/README.md, where someone adopting this surface reads it.`);
    failed = true;
  }
}

if (failed) {
  console.error("\nEvery utility class forge emits must be textually visible to a consumer's Tailwind scan.");
  process.exit(1);
}

console.log("\nAll @source coverage verified.");
