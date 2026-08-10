import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { findSubpathCitations, uncitedSubpaths } from "./docs-parse";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = (pkg as { name: string }).name;
const PKG_EXPORTS = (pkg as { exports?: Record<string, { import?: string; types?: string } | string> }).exports ?? {};
const EXPORT_SUBPATHS = new Set(Object.keys(PKG_EXPORTS).filter((key) => !key.includes("*")));

/**
 * Exact keys plus Node's subpath patterns, and a pattern match carries **one extra assertion an
 * exact key does not need**: the file it names must exist.
 *
 * An exact key is proven real by `validate-exports`, so a doc citing it is citing something that
 * resolves. A pattern matches by shape, so `…/theme-forest.css` would satisfy `…/css/*.css` whether
 * or not that file was ever written — the check would pass while sending a reader to a resolution
 * error. Resolving the pattern's target back to disk is what keeps this as strong as it was before
 * patterns existed.
 */
const EXPORT_PATTERNS = Object.entries(PKG_EXPORTS)
  .filter(([key]) => key.includes("*"))
  .map(([key, value]) => {
    const target = typeof value === "string" ? value : (value.import ?? value.types);
    // Only starred keys reach here, so both halves of each split are present; the defaults never apply.
    const [keyPrefix = "", keySuffix = ""] = key.split("*");
    const [targetPrefix = "", targetSuffix = ""] = (target ?? "").split("*");
    return { keyPrefix, keySuffix, targetPrefix, targetSuffix };
  });

function isExportSubpath(subpath: string): boolean {
  if (EXPORT_SUBPATHS.has(subpath)) return true;
  return EXPORT_PATTERNS.some(({ keyPrefix, keySuffix, targetPrefix, targetSuffix }) => {
    if (!subpath.startsWith(keyPrefix) || !subpath.endsWith(keySuffix)) return false;
    if (subpath.length < keyPrefix.length + keySuffix.length) return false;
    const star = subpath.slice(keyPrefix.length, subpath.length - keySuffix.length);
    return existsSync(resolve(ROOT, `${targetPrefix}${star}${targetSuffix}`));
  });
}

const DECISIONS_DIR = resolve(ROOT, ".decisions");
const GUIDE_INDEX_OWNER = "CLAUDE.md";

/** The repository's front page — the first document a consumer reads, and until now the one
 *  markdown file with no automated check at all. It is deliberately *not* a governing document:
 *  including it here subjects it to the subpath, rot and reference checks, while the numbered-
 *  section format stays out of reach because §-parsing, frontmatter, size and Quick Reference are
 *  all gated on `.decisions/`. No flag is needed to exempt it. */
const ROOT_README = "README.md";

const SIZE_WARN = 600;
const SIZE_FAIL = 800;
const DESCRIPTION_MAX = 200;

// Run state, shared by the seven checks below rather than threaded through all of them. `main` is
// the only writer that resets it, so importing this module observes a zero count and an empty list —
// and a second call to `main` starts from the same place a fresh process would.
let failures = 0;
let warnings: string[] = [];

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
  if (existsSync(resolve(ROOT, ROOT_README))) files.push(ROOT_README);

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

/**
 * Published subpaths the root README is licensed *not* to cite: the three JSX runtime entry points,
 * which are written by the compiler and by build configuration and never by a consumer.
 * `src/jsx/README.md` says so directly — they are imported "only in build configuration" — and the
 * consumer's real obligation, setting `jsxImportSource`, is already covered under §Supported
 * Environments. A table row for any of the three would document an import the reader must not write.
 *
 * Subpath *patterns* are excluded structurally rather than listed: `EXPORT_SUBPATHS` drops every
 * starred key, because one row per stylesheet is exactly the enumeration a pattern exists to replace
 * (`NAMESPACE_DESIGN.md` §3a).
 */
const TABLE_EXEMPT_SUBPATHS = new Set(["./jsx/jsx-runtime", "./jsx/jsx-dev-runtime", "./jsx/register"]);

function isGoverningDoc(file: string): boolean {
  return file.startsWith(".decisions/") || file === GUIDE_INDEX_OWNER || file.startsWith(".claude/agents/");
}

/**
 * Which files have *every* `@y-core/forge/…` string checked, rather than only those on a line that
 * looks like an import statement.
 *
 * The root README is strict alongside the governing docs, and the reason is the defect that put it
 * here: its stale subpaths lived in a markdown table cell and in a `**[…](…)**` link, neither of
 * which matches `IMPORT_POSITION`. Restricted to import positions, the check would have read the
 * file and found nothing — passing while the front page sent consumers to a resolution error.
 *
 * The cost is that the root README may no longer *name* a subpath in order to deny it. That is the
 * intended trade: an absence is described with the real subpaths that do exist ("each client is
 * imported from its own subpath; there is no aggregate `storage` barrel") rather than by quoting a
 * path that resolves to nothing.
 */
function isSubpathStrict(file: string): boolean {
  return isGoverningDoc(file) || file === ROOT_README;
}

function checkImportPaths(file: string, source: string): void {
  for (const { line, raw, subpath } of findSubpathCitations(source, PACKAGE_NAME, { strict: isSubpathStrict(file) })) {
    if (DOCUMENTED_NON_EXPORTS.has(subpath)) continue;
    if (!isExportSubpath(subpath)) {
      fail(file, `line ${line}: \`${PACKAGE_NAME}${raw}\` is not reachable through package.json exports`);
    }
  }
}

/**
 * The other direction: a published subpath the front page never names.
 *
 * A whole-file assertion, not a per-line one — the property is that the citation exists somewhere in
 * the README, so it is checked once against the entire source. Strict matching is what makes a table
 * cell and a `**[…](…)**` link both count, which is where these citations actually live.
 */
function checkExportCoverage(source: string): void {
  const citations = findSubpathCitations(source, PACKAGE_NAME, { strict: true });
  for (const subpath of uncitedSubpaths(EXPORT_SUBPATHS, citations, TABLE_EXEMPT_SUBPATHS)) {
    fail(
      ROOT_README,
      `\`${subpath}\` is published by package.json exports but not cited in README.md — add a namespace-table row, or add it to TABLE_EXEMPT_SUBPATHS in scripts/validate-docs.ts with its rationale`,
    );
  }
}

// ── Check 2: section numbering ────────────────────────────────────────────────────────────────
type Section = { number: string; title: string; level: number; line: number };

function parseSections(file: string, lines: string[]): Section[] {
  const sections: Section[] = [];
  const seen = new Map<string, number>();
  let parent: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const heading = line.match(/^(#{2,3}) (.*)$/);
    if (!heading) continue;

    // Both groups of the heading pattern are mandatory, so a match implies both.
    const [, hashes = "", rest = ""] = heading;
    const level = hashes.length;
    const numbered = rest.match(/^(\d[A-Za-z0-9]*)\. (.+)$/);

    if (!numbered) {
      if (/^\d+\.\d/.test(rest)) {
        fail(file, `line ${i + 1}: dot-notation heading \`${rest}\` — use \`Na.\` (see AGENT_GUIDE.md §2b)`);
      } else {
        fail(file, `line ${i + 1}: unnumbered heading \`${rest}\` — every section needs a citable number`);
      }
      continue;
    }

    // Both groups of the numbering pattern are mandatory, so a match implies both.
    const [, number = "", title = ""] = numbered;
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
    if (line === undefined) continue;

    // Markdown links to sibling markdown documents must resolve on disk.
    for (const match of line.matchAll(/\]\((\.{0,2}\/?[A-Za-z0-9._\-/]+\.md)(?:#[A-Za-z0-9-]+)?\)/g)) {
      // The pattern's single group is mandatory, so a match implies it.
      const [, href = ""] = match;
      const target = resolve(fileDir, href);
      if (!existsSync(target)) {
        fail(file, `line ${i + 1}: link target \`${href}\` does not exist`);
      }
    }

    // `OTHER.md §N` — the cited section must exist in that document.
    for (const match of line.matchAll(/([A-Z_]+\.md)`?\)?\s+§([0-9][A-Za-z0-9]*)/g)) {
      // Both groups are mandatory, so a match implies both.
      const [, doc = "", section = ""] = match;
      const known = sectionsByDoc.get(doc);
      if (!known) continue; // not a governing document we parsed
      if (!known.has(section)) {
        fail(file, `line ${i + 1}: \`${doc} §${section}\` does not resolve to a section in that document`);
      }
    }

    // Bare `§N` — an intra-document reference, unless the same line named another document.
    if (/[A-Z_]+\.md/.test(line)) continue;
    if (ownSections.size === 0) continue;
    for (const match of line.matchAll(/§([0-9][A-Za-z0-9]*)/g)) {
      const [, section = ""] = match;
      if (!ownSections.has(section)) {
        fail(file, `line ${i + 1}: intra-document \`§${section}\` does not resolve to a section in this file`);
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
    const line = lines[i];
    if (line === undefined) continue;

    const date = line.match(/\d{4}-\d{2}-\d{2}/);
    if (date) fail(file, `line ${i + 1}: calendar date \`${date[0]}\` — governing docs carry no history (AGENT_GUIDE.md §9)`);

    const ticket = line.match(/\b[A-Z]{1,3}\d+-\d+(?:\.\d+)*\b/);
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
    const line = lines[i];
    if (line === undefined) continue;
    if (/^## /.test(line)) {
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
    const line = lines[i];
    if (line === undefined) continue;
    if (/^## /.test(line)) {
      end = i;
      break;
    }
  }

  const indexed = new Set<string>();
  for (const line of lines.slice(start, end)) {
    for (const match of line.matchAll(/\]\((?:\.\/)?\.decisions\/([A-Za-z0-9_]+\.md)\)/g)) {
      // The pattern's single group is mandatory, so a match implies it.
      const [, doc = ""] = match;
      indexed.add(doc);
      if (!existsSync(resolve(DECISIONS_DIR, doc))) {
        fail(GUIDE_INDEX_OWNER, `Guide Index names \`${doc}\`, which does not exist`);
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
/** Runs every check and returns the exit code rather than exiting, so a test can import this module,
 *  call it, and read the verdict without the runner dying. Nothing above this line reads a document —
 *  the walk starts here. */
export function main(): number {
  failures = 0;
  warnings = [];

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

  const rootReadme = sources.get(ROOT_README);
  if (rootReadme !== undefined) checkExportCoverage(rootReadme);

  checkGuideIndex([...sectionsByDoc.keys()].sort());

  for (const line of warnings) console.warn(line);

  if (failures > 0) {
    console.error(`\n${failures} problem${failures === 1 ? "" : "s"} found.`);
    return 1;
  }
  console.log(`\nAll docs verified (${files.length} files, ${warnings.length} warnings).`);
  return 0;
}

if (import.meta.main) process.exit(main());
