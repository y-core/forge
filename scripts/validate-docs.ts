import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = (pkg as { name: string }).name;
const EXPORT_SUBPATHS = new Set(Object.keys((pkg as { exports?: Record<string, unknown> }).exports ?? {}));

const DECISIONS_DIR = resolve(ROOT, ".decisions");
const GUIDE_INDEX_OWNER = "CLAUDE.md";

const SIZE_WARN = 600;
const SIZE_FAIL = 800;
const DESCRIPTION_MAX = 200;

let failures = 0;
const warnings: string[] = [];

function fail(file: string, message: string): void {
  console.error(`FAIL ${file}: ${message}`);
  failures++;
}

function warn(file: string, message: string): void {
  warnings.push(`WARN ${file}: ${message}`);
}

/**
 * Strips fenced code blocks, leaving line count intact so reported line numbers stay true.
 * Import paths are checked against the raw source (they legitimately live in samples); section
 * numbers, cross-references, and rot markers are checked against the stripped source, because a
 * sample heading or a sample log timestamp is illustration, not content.
 */
function stripFences(source: string): string[] {
  const lines = source.split("\n");
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return "";
    }
    if (inFence) return "";
    // A 4-space indent marks an illustrative block (the convention §2b mandates for sample
    // headings). Blanking it keeps sample `§N` refs and sample headings out of the checks.
    if (/^ {4,}\S/.test(line)) return "";
    return line;
  });
}

function collectMarkdown(): string[] {
  const files: string[] = [];

  if (existsSync(DECISIONS_DIR)) {
    for (const entry of readdirSync(DECISIONS_DIR)) {
      if (entry.endsWith(".md")) files.push(join(".decisions", entry));
    }
  }
  if (existsSync(resolve(ROOT, GUIDE_INDEX_OWNER))) files.push(GUIDE_INDEX_OWNER);

  const agentsDir = resolve(ROOT, ".claude/agents");
  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir)) {
      if (entry.endsWith(".md")) files.push(join(".claude/agents", entry));
    }
  }

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === "README.md") files.push(relative(ROOT, full));
    }
  };
  const srcDir = resolve(ROOT, "src");
  if (existsSync(srcDir)) walk(srcDir);

  return files.sort();
}

// ── Check 1: every documented import path resolves to a real export subpath ───────────────────
// The single highest-value assertion here: a documented subpath that does not exist sends a
// consumer to a module resolution error, and no other gate step reads prose.

// Subpaths a governing document may name despite their absence from the exports map: two
// prospective namespaces the Growth Rules tell authors to create, one aggregator named only to
// forbid it, and the sealed-internal namespace (`SEALED_INTERNAL` in validate-exports.ts).
const DOCUMENTED_NON_EXPORTS = new Set(["./auth", "./handler", "./all", "./crypto"]);

// A README's job includes describing what does *not* exist ("there is no top-level
// `@y-core/forge/storage` barrel"), so only genuine import positions are checked there.
// Governing documents are checked everywhere: under §8 they cite paths, they do not narrate them.
const IMPORT_POSITION = /\b(?:from|import)\s*\(?\s*["']/;

function isGoverningDoc(file: string): boolean {
  return file.startsWith(".decisions/") || file === GUIDE_INDEX_OWNER || file.startsWith(".claude/agents/");
}

function checkImportPaths(file: string, source: string): void {
  const re = new RegExp(`${PACKAGE_NAME.replace("/", "\\/")}(\\/[A-Za-z0-9._\\-\\/]*)`, "g");
  const strict = isGoverningDoc(file);
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (!strict && !IMPORT_POSITION.test(lines[i])) continue;

    for (const match of lines[i].matchAll(re)) {
      const raw = match[1];
      if (!raw || raw.endsWith("/")) continue; // bare name, or a `{namespace}`/`<subpath>` placeholder
      if (raw.includes("...")) continue; // an elided path fragment, not a subpath

      const subpath = `.${raw.replace(/[.\-/]+$/, "")}`;
      if (DOCUMENTED_NON_EXPORTS.has(subpath)) continue;
      if (!EXPORT_SUBPATHS.has(subpath)) {
        fail(file, `line ${i + 1}: \`${PACKAGE_NAME}${raw}\` is not a key in package.json exports`);
      }
    }
  }
}

// ── Check 2: section numbering ────────────────────────────────────────────────────────────────
type Section = { number: string; title: string; level: number; line: number };

function parseSections(file: string, lines: string[]): Section[] {
  const sections: Section[] = [];
  const seen = new Map<string, number>();
  let parent: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^(#{2,3}) (.*)$/);
    if (!heading) continue;

    const level = heading[1].length;
    const rest = heading[2];
    const numbered = rest.match(/^(\d[A-Za-z0-9]*)\. (.+)$/);

    if (!numbered) {
      if (/^\d+\.\d/.test(rest)) {
        fail(file, `line ${i + 1}: dot-notation heading \`${rest}\` — use \`Na.\` (see AGENT_GUIDE.md §2b)`);
      } else {
        fail(file, `line ${i + 1}: unnumbered heading \`${rest}\` — every section needs a citable number`);
      }
      continue;
    }

    const [, number, title] = numbered;
    const previous = seen.get(number);
    if (previous !== undefined) {
      fail(file, `line ${i + 1}: duplicate section number \`${number}\` (first seen at line ${previous})`);
    }
    seen.set(number, i + 1);

    if (level === 2) {
      parent = number;
    } else if (parent !== null && !number.startsWith(parent)) {
      fail(file, `line ${i + 1}: \`### ${number}.\` is not prefixed by its parent \`## ${parent}.\``);
    }

    sections.push({ number, title, level, line: i + 1 });
  }
  return sections;
}

// ── Check 3: reference integrity ──────────────────────────────────────────────────────────────
function checkReferences(file: string, lines: string[], ownSections: Set<string>, sectionsByDoc: Map<string, Set<string>>): void {
  const fileDir = dirname(resolve(ROOT, file));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Markdown links to sibling markdown documents must resolve on disk.
    for (const match of line.matchAll(/\]\((\.{0,2}\/?[A-Za-z0-9._\-/]+\.md)(?:#[A-Za-z0-9-]+)?\)/g)) {
      const target = resolve(fileDir, match[1]);
      if (!existsSync(target)) {
        fail(file, `line ${i + 1}: link target \`${match[1]}\` does not exist`);
      }
    }

    // `OTHER.md §N` — the cited section must exist in that document.
    for (const match of line.matchAll(/([A-Z_]+\.md)`?\)?\s+§([0-9][A-Za-z0-9]*)/g)) {
      const doc = match[1];
      const known = sectionsByDoc.get(doc);
      if (!known) continue; // not a governing document we parsed
      if (!known.has(match[2])) {
        fail(file, `line ${i + 1}: \`${doc} §${match[2]}\` does not resolve to a section in that document`);
      }
    }

    // Bare `§N` — an intra-document reference, unless the same line named another document.
    if (/[A-Z_]+\.md/.test(line)) continue;
    if (ownSections.size === 0) continue;
    for (const match of line.matchAll(/§([0-9][A-Za-z0-9]*)/g)) {
      if (!ownSections.has(match[1])) {
        fail(file, `line ${i + 1}: intra-document \`§${match[1]}\` does not resolve to a section in this file`);
      }
    }
  }
}

// ── Check 4: frontmatter ──────────────────────────────────────────────────────────────────────
function checkFrontmatter(file: string, source: string): void {
  if (!source.startsWith("---\n")) {
    fail(file, "missing YAML frontmatter");
    return;
  }
  const end = source.indexOf("\n---", 4);
  if (end === -1) {
    fail(file, "unterminated YAML frontmatter");
    return;
  }
  const block = source.slice(4, end);

  const title = block.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  if (!title) fail(file, "frontmatter is missing `title`");

  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!description) {
    fail(file, "frontmatter is missing `description`");
    return;
  }
  const text = description.replace(/^["']|["']$/g, "");
  if (text.length > DESCRIPTION_MAX) {
    fail(file, `frontmatter \`description\` is ${text.length} chars (max ${DESCRIPTION_MAX}) — one sentence (AGENT_GUIDE.md §4b)`);
  }
}

// ── Check 5: size ─────────────────────────────────────────────────────────────────────────────
function checkSize(file: string, lineCount: number): void {
  if (lineCount > SIZE_FAIL) {
    fail(file, `${lineCount} lines exceeds the ${SIZE_FAIL}-line hard limit — split or cut (AGENT_GUIDE.md §6a)`);
  } else if (lineCount > SIZE_WARN) {
    warn(file, `${lineCount} lines exceeds the ${SIZE_WARN}-line target`);
  }
}

// ── Check 6: dated or ticketed content ────────────────────────────────────────────────────────
function checkRot(file: string, lines: string[]): void {
  for (let i = 0; i < lines.length; i++) {
    const date = lines[i].match(/\d{4}-\d{2}-\d{2}/);
    if (date) fail(file, `line ${i + 1}: calendar date \`${date[0]}\` — governing docs carry no history (AGENT_GUIDE.md §9)`);

    const ticket = lines[i].match(/\b[A-Z]{1,3}\d+-\d+(?:\.\d+)*\b/);
    if (ticket) fail(file, `line ${i + 1}: ticket identifier \`${ticket[0]}\` — governing docs carry no task IDs (AGENT_GUIDE.md §9)`);
  }
}

// ── Check 7 (warn-only): Quick Reference completeness ─────────────────────────────────────────
function checkQuickReference(file: string, lines: string[], sections: Section[]): void {
  const start = lines.findIndex((line) => /^## 0\. /.test(line));
  if (start === -1) {
    warn(file, "no `## 0. Quick Reference` — the document has no section map (AGENT_GUIDE.md §7)");
    return;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  const block = lines.slice(start, end).join("\n");
  const listed = new Set([...block.matchAll(/§([0-9][A-Za-z0-9]*)/g)].map((m) => m[1]));

  const missing = sections.filter((s) => s.number !== "0" && !listed.has(s.number)).map((s) => s.number);
  if (missing.length > 0) {
    warn(file, `Quick Reference omits ${missing.map((n) => `§${n}`).join(", ")}`);
  }
}

// ── Guide Index cross-check ───────────────────────────────────────────────────────────────────
function checkGuideIndex(decisionsDocs: string[]): void {
  const claudePath = resolve(ROOT, GUIDE_INDEX_OWNER);
  if (!existsSync(claudePath)) return;

  const lines = readFileSync(claudePath, "utf-8").split("\n");
  const start = lines.findIndex((line) => /^## Guide Index/.test(line));
  if (start === -1) {
    fail(GUIDE_INDEX_OWNER, "no `## Guide Index` section");
    return;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }

  const indexed = new Set<string>();
  for (const line of lines.slice(start, end)) {
    for (const match of line.matchAll(/\]\((?:\.\/)?\.decisions\/([A-Za-z0-9_]+\.md)\)/g)) {
      indexed.add(match[1]);
      if (!existsSync(resolve(DECISIONS_DIR, match[1]))) {
        fail(GUIDE_INDEX_OWNER, `Guide Index names \`${match[1]}\`, which does not exist`);
      }
    }
  }

  for (const doc of decisionsDocs) {
    if (!indexed.has(doc)) {
      fail(GUIDE_INDEX_OWNER, `\`.decisions/${doc}\` is not registered in the Guide Index (AGENT_GUIDE.md §5c)`);
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────
const files = collectMarkdown();
const sources = new Map<string, string>();
const sectionsByDoc = new Map<string, Set<string>>();
const parsed = new Map<string, Section[]>();

for (const file of files) {
  const source = readFileSync(resolve(ROOT, file), "utf-8");
  sources.set(file, source);
  if (!file.startsWith(".decisions/")) continue;
  const sections = parseSections(file, stripFences(source));
  parsed.set(file, sections);
  sectionsByDoc.set(file.slice(".decisions/".length), new Set(sections.map((s) => s.number)));
}

for (const file of files) {
  const source = sources.get(file) as string;
  const stripped = stripFences(source);
  const isDecision = file.startsWith(".decisions/");
  const before = failures;

  checkImportPaths(file, source);
  checkRot(file, stripped);
  checkReferences(file, stripped, new Set((parsed.get(file) ?? []).map((s) => s.number)), sectionsByDoc);

  if (isDecision) {
    checkFrontmatter(file, source);
    checkSize(file, source.split("\n").length);
    checkQuickReference(file, stripped, parsed.get(file) as Section[]);
  }

  if (failures === before) console.log(`  ok ${file}`);
}

checkGuideIndex([...sectionsByDoc.keys()].sort());

for (const line of warnings) console.warn(line);

if (failures > 0) {
  console.error(`\n${failures} problem${failures === 1 ? "" : "s"} found.`);
  process.exit(1);
}
console.log(`\nAll docs verified (${files.length} files, ${warnings.length} warnings).`);
