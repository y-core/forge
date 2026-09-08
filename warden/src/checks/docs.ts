import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import type { ExportsMap } from "../../../src/tooling/gate/checks/exports";
import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import { type CheckResult, checkResult, type Finding, fail, scannedNothing, warn } from "../../../src/tooling/gate/finding";
import { findSubpathCitations, quickReference, uncitedSubpaths } from "./docs-parse";

/** The canon tree a directory's documents are read from. @public */
export type DocKind = "libs" | "apps" | "shared";

/** An `extraDirs` entry that declares its readers' tree. @public */
export interface ExtraDir {
  /** Directory relative to `root`, or one `.md` document. */
  dir: string;
  /** The tree its readers stand in; omitted where they read this repository's own documents. */
  kind?: DocKind;
  /** Whether its documents are numbered governing prose, held to the full `decisionsDir` format.
   *
   *  Off by default because an `extraDirs` entry is as often unnumbered prose — the agent briefs —
   *  where every section would report as malformed and every file as missing its Quick Reference. */
  numbered?: boolean;
}

/** What the docs check needs to know about the project. @public */
export interface DocsCheckConfig {
  /** Application root. */
  root: string;
  /** The package name consumers import under. */
  packageName: string;
  /** The `exports` map, verbatim from `package.json`. */
  exports: ExportsMap;
  /** Directory of numbered governing documents, relative to `root`. Defaults to `.decisions`. */
  decisionsDir?: string;
  /** The document owning the index that must register every governing doc. Defaults to `CLAUDE.md`. */
  guideIndexOwner?: string;
  /** The repository front page, held to the strict subpath rules. Defaults to `README.md`. */
  rootReadme?: string;
  /** The canon tree this repository's own documents read from — `libs` for a library, `apps` for an
   *  application. Without it a bare citation into a canon that ships more than one tree is
   *  ambiguous, because nothing else says which of them this repository is shipped. */
  kind?: DocKind;
  /** Extra directories of markdown held to the prose rules, relative to `root`.
   *
   *  A bare string is a directory whose documents read as this repository's own. The object form
   *  declares which canon tree the directory's readers stand in, which is what lets a bare
   *  `CODE_RULES.md` citation resolve: the same filename exists in more than one tree, and only the
   *  citing file's position says which one it meant. */
  extraDirs?: readonly (string | ExtraDir)[];
  /** Directories of numbered documents this repository cites but does not own — the fleet canon.
   *  Their sections resolve a citation; they are not themselves validated or index-reconciled.
   *  Each is keyed by its own directory name, so `libs/TESTING.md` cannot silently displace the
   *  `TESTING.md` this repository owns; a bare citation naming both is settled by where the citing
   *  file sits, and reported ambiguous only where that leaves more than one candidate. */
  citableDirs?: readonly string[];
  /** Source root walked for `README.md` files, relative to `root`. Defaults to `src`. */
  sourceDir?: string;
  /** Subpaths a document may name despite their absence from the exports map. */
  documentedNonExports?: readonly string[];
  /** Published subpaths the front page is licensed *not* to cite. */
  tableExemptSubpaths?: readonly string[];
  /** Documents that must enumerate every published subpath, each with its own exemptions.
   *
   *  A list because two catalogs have genuinely different scopes: the front page covers every
   *  published subpath, a namespace catalog covers the runtime ones. Defaults to the front page
   *  alone, held against `tableExemptSubpaths`. */
  catalogs?: readonly { doc: string; exempt?: readonly string[] }[];
  /** Published subpaths licensed to be listed in a table and bound by no prose rule.
   *
   *  A row lists a subpath; a prose rule binds it (`NAMESPACES.md` §7). Warn, not fail, so a
   *  backlog is triaged rather than exempted wholesale. */
  listedOnlySubpaths?: readonly string[];
  /** Line count above which a governing document warns. Defaults to 600. */
  sizeWarn?: number;
  /** Line count above which it fails. Defaults to 800. */
  sizeFail?: number;
  /** Maximum frontmatter `description` length. Defaults to 200. */
  descriptionMax?: number;
  /** Directories held to Quick Reference agreement and nothing else.
   *
   *  For a tree that is governed prose but not this repository's own — the canon, in the repository
   *  that houses it. Its Quick Reference lines become the index's glosses exactly as a local
   *  document's do, so a stale one mis-describes a section to every consumer; the rest of these
   *  checks are written against a repository's own conventions and are not its to answer. */
  agreementDirs?: string[];
}

interface Section {
  number: string;
  title: string;
  level: number;
  line: number;
}

const INTER_DOC_CITATION = /((?:[A-Za-z0-9_-]+\/)?[A-Z_]+\.md)`?\)?\s+§([0-9][A-Za-z0-9]*)((?:(?:,|\s+and|\s+or)\s+§[0-9][A-Za-z0-9]*)*)/g;
const LINE_FINAL_DOC_LINK = /\]\([^()]*[A-Z_]+\.md\)`?\s*$/;
const LEADING_SECTION = /^\s*§[0-9][A-Za-z0-9]*/;
const BARE_SECTION = /§([0-9][A-Za-z0-9]*)/g;
const BACKTICKED_PATH = /`((?:src|config|\.claude)\/[^`]*)`/g;
const UNRESOLVABLE_PATH = /[*<{…\s]/;
const ROT_PROSE = /\b(previously|no longer|used to|formerly|renamed from|fixed by|has since)\b/i;
const INLINE_CODE = /`[^`]*`/g;
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g;

const LIST_MARKER = /^ {0,3}(?:[-*+]|\d+[.)])\s/;

/** Strip fenced and indented code blocks, leaving the line count intact so reported line numbers
 *  stay true. Indentation is code only where CommonMark says so — after a blank line and outside a
 *  list, so a wrapped citation and a nested bullet stay visible to every check downstream. @public */
export function stripFences(source: string): string[] {
  let inFence = false;
  let afterBlank = true;
  let inList = false;
  let inCode = false;

  return source.split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      afterBlank = false;
      return "";
    }
    if (inFence) return "";

    const blank = line.trim() === "";
    const indented = /^ {4,}\S/.test(line);

    // An indented block opens only after a blank line and outside a list, then runs on through its
    // own indented and blank lines until one starts back at the margin.
    if (inCode) {
      if (!blank && !indented) inCode = false;
    } else if (indented && afterBlank && !inList) {
      inCode = true;
    }
    // A list stays open across its own indented continuations, and closes at the first line that
    // starts back at the margin.
    if (!blank && !indented) inList = LIST_MARKER.test(line);

    const isCode = inCode && !blank;
    afterBlank = blank;
    return isCode ? "" : line;
  });
}

/** Parse the numbered headings of one document, reporting malformed and duplicate numbering. @public */
export function parseSections(file: string, lines: readonly string[]): { sections: Section[]; findings: Finding[] } {
  const sections: Section[] = [];
  const findings: Finding[] = [];
  const seen = new Map<string, number>();
  let parent: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const heading = line.match(/^(#{2,3}) (.*)$/);
    if (!heading) continue;

    const [, hashes = "", rest = ""] = heading;
    const level = hashes.length;
    const numbered = rest.match(/^(\d[A-Za-z0-9]*)\. (.+)$/);

    if (!numbered) {
      findings.push(
        /^\d+\.\d/.test(rest)
          ? fail(`dot-notation heading \`${rest}\` — use \`Na.\``, { file, line: i + 1 })
          : fail(`unnumbered heading \`${rest}\` — every section needs a citable number`, { file, line: i + 1 }),
      );
      continue;
    }

    const [, number = "", title = ""] = numbered;
    const previous = seen.get(number);
    if (previous !== undefined) {
      findings.push(fail(`duplicate section number \`${number}\` (first seen at line ${previous})`, { file, line: i + 1 }));
    }
    seen.set(number, i + 1);

    if (level === 2) parent = number;
    else if (parent !== null && !number.startsWith(parent)) {
      findings.push(fail(`\`### ${number}.\` is not prefixed by its parent \`## ${parent}.\``, { file, line: i + 1 }));
    }

    sections.push({ number, title, level, line: i + 1 });
  }
  return { sections, findings };
}

/** The lines of the block a `## ` heading opens, up to the next `## `. */
function blockAfter(lines: readonly string[], startPattern: RegExp): { start: number; lines: string[] } | null {
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if ((lines[i] ?? "").startsWith("## ")) {
      end = i;
      break;
    }
  }
  return { start, lines: lines.slice(start, end) };
}

/** Calendar dates and ticket identifiers — a governing document carries no history. @public */
export function validateNoRot(file: string, lines: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const date = line.match(/\d{4}-\d{2}-\d{2}/);
    if (date) findings.push(fail(`calendar date \`${date[0]}\` — governing docs carry no history`, { file, line: i + 1 }));
    const ticket = line.match(/\b[A-Z]{1,3}\d+-\d+(?:\.\d+)*\b/);
    if (ticket) findings.push(fail(`ticket identifier \`${ticket[0]}\` — governing docs carry no task IDs`, { file, line: i + 1 }));
  }
  return findings;
}

/** A title flattened for comparison: links to their text, backticks and case dropped, whitespace
 *  collapsed, and a trailing parenthetical removed — `Fragment Renderers (`http` namespace)` and
 *  `Fragment Renderers: …` name the same section and must not read as a disagreement. */
function flattenTitle(text: string): string {
  return text
    .replace(INLINE_LINK, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .toLowerCase();
}

/** The phrase a title leads with, up to the punctuation that starts its qualifier. Both spellings
 *  are in use — `Expected Errors — User Input` in a heading against `Expected Errors: user input`
 *  in the Quick Reference — and neither is drift. */
function leadPhrase(text: string): string {
  return (flattenTitle(text).split(/\s+—\s+|\s+–\s+|:|;|,/)[0] ?? "").trim();
}

/** Every Quick Reference line must still name the heading it summarises.
 *
 *  **The existing check proves the block is complete, not that it is true.** A renamed heading
 *  leaves its Quick Reference line behind, and that line is not decoration: the indexer redistributes
 *  it as the section's gloss, so it becomes the summary every search result displays *and* a ranked
 *  retrieval column. A stale one therefore mis-describes the section to every reader and skews what
 *  the section matches on, while every other check stays green.
 *
 *  Held to the leading phrase rather than the whole line, and satisfied when either side is a prefix
 *  of the other. The corpus abbreviates a heading in its Quick Reference on purpose, and a check
 *  that failed on that would be turned off within a week. What survives is the case this exists
 *  for: a heading renamed to say something else. */
function validateQuickReferenceAgreement(file: string, lines: readonly string[], sections: readonly Section[]): Finding[] {
  const entries = quickReference(lines);
  const findings: Finding[] = [];

  for (const section of sections) {
    if (section.number === "0") continue;
    const entry = entries.get(section.number);
    if (entry === undefined) continue;

    const heading = leadPhrase(section.title);
    const summary = leadPhrase(entry);
    if (heading === "" || summary === "") continue;
    if (heading.startsWith(summary) || summary.startsWith(heading)) continue;

    findings.push(
      fail(`Quick Reference §${section.number} says \`${summary}\` where the heading says \`${heading}\` — one of the two is stale`, {
        file,
        line: section.line + 1,
      }),
    );
  }
  return findings;
}

/** Prose narrating a change — a governing document describes only the present. */
function validateRotProse(file: string, lines: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]?.replace(INLINE_CODE, " ").match(ROT_PROSE);
    if (match) findings.push(fail(`historical phrasing \`${match[0]}\` — governing docs carry no history`, { file, line: i + 1 }));
  }
  return findings;
}

/** Every backticked repository path a governing document names must exist on disk. */
function validatePaths(file: string, lines: readonly string[], root: string): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const match of (lines[i] ?? "").matchAll(BACKTICKED_PATH)) {
      const path = (match[1] ?? "").replace(/\/+$/, "");
      if (path === "" || UNRESOLVABLE_PATH.test(path)) continue;
      if (!existsSync(resolve(root, path))) findings.push(fail(`path \`${path}\` does not exist`, { file, line: i + 1 }));
    }
  }
  return findings;
}

/** Frontmatter presence and shape. @public */
export function validateFrontmatter(file: string, source: string, descriptionMax: number): Finding[] {
  if (!source.startsWith("---\n")) return [fail("missing YAML frontmatter", { file })];
  const end = source.indexOf("\n---", 4);
  if (end === -1) return [fail("unterminated YAML frontmatter", { file })];

  const block = source.slice(4, end);
  const findings: Finding[] = [];

  for (const match of block.matchAll(/^([A-Za-z][A-Za-z0-9_-]*):/gm)) {
    const [, key = ""] = match;
    if (key !== "title" && key !== "description") {
      findings.push(fail(`unexpected frontmatter key \`${key}\` — \`title\` and \`description\` only`, { file }));
    }
  }

  if (!block.match(/^title:\s*(.+)$/m)?.[1]?.trim()) findings.push(fail("frontmatter is missing `title`", { file }));

  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!description) {
    findings.push(fail("frontmatter is missing `description`", { file }));
    return findings;
  }
  const text = description.replace(/^["']|["']$/g, "");
  if (text.length > descriptionMax) {
    findings.push(fail(`frontmatter \`description\` is ${text.length} chars (max ${descriptionMax}) — one sentence`, { file }));
  }
  return findings;
}

/** Run every check. @public */
export function checkDocs(config: DocsCheckConfig): CheckResult {
  const { root, packageName } = config;
  const decisionsDir = config.decisionsDir ?? ".decisions";
  const guideIndexOwner = config.guideIndexOwner ?? "CLAUDE.md";
  const rootReadme = config.rootReadme ?? "README.md";
  const sourceDir = config.sourceDir ?? "src";
  const sizeWarn = config.sizeWarn ?? 600;
  const sizeFail = config.sizeFail ?? 800;
  const descriptionMax = config.descriptionMax ?? 200;
  const documentedNonExports = new Set(config.documentedNonExports ?? []);
  const catalogs = config.catalogs ?? [{ doc: rootReadme, exempt: config.tableExemptSubpaths }];
  const listedOnly = new Set(config.listedOnlySubpaths ?? []);

  const findings: Finding[] = [];
  const proseBound = new Set<string>();

  const exportSubpaths = new Set(Object.keys(config.exports).filter((key) => !key.includes("*")));
  const exportPatterns = Object.entries(config.exports)
    .filter(([key]) => key.includes("*"))
    .map(([key, value]) => {
      const target = typeof value === "string" ? value : (value.import ?? value.types);
      const [keyPrefix = "", keySuffix = ""] = key.split("*");
      const [targetPrefix = "", targetSuffix = ""] = (target ?? "").split("*");
      return { keyPrefix, keySuffix, targetPrefix, targetSuffix };
    });

  const isExportSubpath = (subpath: string): boolean => {
    if (exportSubpaths.has(subpath)) return true;
    return exportPatterns.some(({ keyPrefix, keySuffix, targetPrefix, targetSuffix }) => {
      if (!subpath.startsWith(keyPrefix) || !subpath.endsWith(keySuffix)) return false;
      if (subpath.length < keyPrefix.length + keySuffix.length) return false;
      const star = subpath.slice(keyPrefix.length, subpath.length - keySuffix.length);
      return existsSync(resolve(root, `${targetPrefix}${star}${targetSuffix}`));
    });
  };

  const files: string[] = [];
  const decisionsPath = resolve(root, decisionsDir);
  if (existsSync(decisionsPath)) {
    files.push(...collectFiles(root, decisionsDir, (name) => name.endsWith(".md")));
    // A directory that exists and yields nothing is a discovery bug, not a clean repository.
    if (files.length === 0) findings.push(fail(`\`${decisionsDir}/\` exists but holds no documents`, { file: decisionsDir }));
  } else if (config.decisionsDir !== undefined) {
    // A configured directory that is not there validates nothing while the other roots still fill
    // `files` — a silent green, and the failure mode a mistyped `decisionsDir` lands in.
    findings.push(fail(`\`${decisionsDir}/\` is configured but does not exist`, { file: decisionsDir }));
  }
  if (existsSync(resolve(root, guideIndexOwner))) files.push(guideIndexOwner);
  if (existsSync(resolve(root, rootReadme))) files.push(rootReadme);
  const extraDirs: readonly ExtraDir[] = (config.extraDirs ?? []).map((entry) => (typeof entry === "string" ? { dir: entry } : entry));
  for (const { dir } of extraDirs) {
    // An entry may name one document rather than a directory: a governing file that sits beside a
    // tree already held under a different kind cannot be reached by widening that tree's root.
    if (dir.endsWith(".md")) {
      if (existsSync(resolve(root, dir))) files.push(dir);
      continue;
    }
    files.push(...collectFiles(root, dir, (name) => name.endsWith(".md")));
  }
  files.push(...collectFiles(root, sourceDir, (name) => name === "README.md"));
  files.sort();

  if (files.length === 0)
    return scannedNothing(`\`${decisionsDir}\`, \`${guideIndexOwner}\`, \`${rootReadme}\` and \`${sourceDir}\` hold no document`, "docs", "read");

  const isGoverning = (file: string): boolean =>
    file.startsWith(`${decisionsDir}/`) || file === guideIndexOwner || extraDirs.some(({ dir }) => file === dir || file.startsWith(`${dir}/`));

  // Which tree a citing file's reader stands in — the whole of what a bare cross-tree citation has
  // to go on. A file under no kind-scoped root reads this repository's own documents.
  const declaredKindOf = (file: string): DocKind | undefined => extraDirs.find(({ dir }) => file === dir || file.startsWith(`${dir}/`))?.kind;

  // A numbered `extraDirs` tree is governing prose that happens not to live under `decisionsDir` —
  // the fleet canon in the repository housing it, and the design corpus. It earns the numbering,
  // Quick Reference and size checks; its sections are not registered as citation targets, because
  // a `citableDirs` entry already keys those by tree and a second bare key would displace them.
  const isNumbered = (file: string): boolean =>
    file.startsWith(`${decisionsDir}/`) || extraDirs.some(({ dir, numbered }) => numbered === true && (file === dir || file.startsWith(`${dir}/`)));

  const isStrict = (file: string): boolean => isGoverning(file) || file === rootReadme;

  const sources = new Map<string, string>();
  const sectionsByDoc = new Map<string, Set<string>>();
  const parsed = new Map<string, Section[]>();

  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf-8");
    sources.set(file, source);
    if (!isNumbered(file)) continue;
    const { sections, findings: sectionFindings } = parseSections(file, stripFences(source));
    findings.push(...sectionFindings);
    parsed.set(file, sections);
    if (file.startsWith(`${decisionsDir}/`))
      sectionsByDoc.set(file.slice(decisionsDir.length + 1), new Set(sections.map((section) => section.number)));
  }

  // A citable root registers its sections and nothing else. Without one, a citation into a document
  // outside `decisionsDir` resolves to no key and is skipped in silence — which is how a whole tree
  // of rules stops being checked the moment it moves out from under this directory.
  const docRoots = [decisionsPath, ...(config.citableDirs ?? []).map((dir) => dirname(resolve(root, dir)))];
  for (const dir of config.citableDirs ?? []) {
    const base = dirname(dir);
    for (const file of collectFiles(root, dir, (name) => name.endsWith(".md"))) {
      const { sections } = parseSections(file, stripFences(readFileSync(resolve(root, file), "utf-8")));
      sectionsByDoc.set(file.slice(base.length + 1), new Set(sections.map((section) => section.number)));
    }
  }

  // Keys are `subdir/DOC.md` once the tree nests, but a citation may name either form. A same-line
  // link resolves it exactly; a bare basename is settled by where the citing file sits.
  const docKeys = [...sectionsByDoc.keys()];
  const resolveDocKey = (file: string, cited: string, line: string): { keys?: string[]; ambiguous?: string[] } => {
    for (const match of line.matchAll(/\]\((\.{0,2}\/?[A-Za-z0-9._\-/]+\.md)\)/g)) {
      const [, href = ""] = match;
      if (href !== cited && !href.endsWith(`/${cited}`)) continue;
      const target = resolve(dirname(resolve(root, file)), href);
      for (const base of docRoots) {
        const key = relative(base, target);
        if (!key.startsWith("..") && sectionsByDoc.has(key)) return { keys: [key] };
      }
    }

    // A citation may spell the decisions directory it is pointing into — the canon does exactly
    // that, naming a reader's own `docs/X.md` in prose (`AGENT_GUIDE.md` §5d). The key is stored
    // relative to that directory, so the prefix has to come off before the name can match.
    const local = cited.startsWith(`${decisionsDir}/`);
    const name = local ? cited.slice(decisionsDir.length + 1) : cited;
    const matches = docKeys.filter((key) => (local ? key === name : key === name || key.endsWith(`/${name}`)));
    if (matches.length === 0) return {};
    if (matches.length === 1) return { keys: matches };

    const settle = (candidates: string[]): { keys: string[] } | undefined => (candidates.length === 1 ? { keys: candidates } : undefined);
    const declared = declaredKindOf(file);
    const kind = declared ?? config.kind;

    // A document of this repository's own means this repository's own document first — the same
    // preference `resolveDoc` applies. Falling through is a citation into the canon, which this
    // repository reads at its own kind exactly as a kind-scoped reader reads theirs.
    if (declared === undefined) {
      const own = settle(matches.filter((key) => !key.includes("/")));
      if (own !== undefined) return own;
    }
    if (kind === undefined) return { ambiguous: matches };

    // A reader scoped to one kind means their own tree, and `shared` where that tree has no such
    // document — the two trees a consumer of that kind is ever shipped.
    if (kind !== "shared") {
      return (
        settle(matches.filter((key) => key.startsWith(`${kind}/`))) ??
        settle(matches.filter((key) => key.startsWith("shared/"))) ?? { ambiguous: matches }
      );
    }

    // A `shared` document is read by every kind at once, so no single tree is the one it meant and
    // no path it could cite would be right for both readers. The citation is resolved when every
    // tree carrying the filename carries the section too, which makes the cross-kind disagreement —
    // the drift only the repository housing the canon can see — the thing that fails.
    const trees = matches.filter((key) => key.includes("/"));
    return trees.length > 0 ? { keys: trees } : { ambiguous: matches };
  };

  for (const file of files) {
    const source = sources.get(file) ?? "";
    const stripped = stripFences(source);

    for (const { kind, line, raw, subpath } of findSubpathCitations(source, packageName, { strict: isStrict(file) })) {
      if (kind === "prose") proseBound.add(subpath);
      if (documentedNonExports.has(subpath)) continue;
      if (!isExportSubpath(subpath)) {
        findings.push(fail(`\`${packageName}${raw}\` is not reachable through package.json exports`, { file, line }));
      }
    }

    findings.push(...validateNoRot(file, stripped));

    const ownSections = new Set((parsed.get(file) ?? []).map((section) => section.number));
    const fileDir = dirname(resolve(root, file));

    // A citation wrapped across a line break is one citation: the link ends a line and its §N opens
    // the next, so the pair is matched joined and the continuation's §N is not a bare token.
    const wrappedContinuations = new Set<number>();
    for (let i = 0; i < stripped.length - 1; i++) {
      if (LINE_FINAL_DOC_LINK.test(stripped[i] ?? "") && LEADING_SECTION.test(stripped[i + 1] ?? "")) wrappedContinuations.add(i + 1);
    }

    for (let i = 0; i < stripped.length; i++) {
      const line = stripped[i];
      if (line === undefined) continue;

      for (const match of line.matchAll(/\]\((\.{0,2}\/?[A-Za-z0-9._\-/]+\.md)(?:#[A-Za-z0-9-]+)?\)/g)) {
        const [, href = ""] = match;
        if (!existsSync(resolve(fileDir, href))) findings.push(fail(`link target \`${href}\` does not exist`, { file, line: i + 1 }));
      }

      const continuation = wrappedContinuations.has(i + 1) ? (stripped[i + 1] ?? "") : "";
      const citationLine = continuation === "" ? line : `${line} ${continuation}`;
      let bare = wrappedContinuations.has(i) ? line.replace(LEADING_SECTION, " ") : line;

      for (const match of citationLine.matchAll(INTER_DOC_CITATION)) {
        const [pair, doc = "", section = "", conjuncts = ""] = match;
        bare = bare.replace(pair, " ");
        const { keys, ambiguous } = resolveDocKey(file, doc, citationLine);
        if (ambiguous !== undefined) {
          findings.push(fail(`\`${doc} §${section}\` is ambiguous — ${ambiguous.join(" and ")} both match; cite the path`, { file, line: i + 1 }));
          continue;
        }
        // Skipping here is how a typo'd or renamed document name passed: a citation naming a
        // document in neither corpus resolves to nothing, and nothing is not a finding by default.
        if (keys === undefined) {
          findings.push(fail(`\`${doc} §${section}\` names no document in this repository or the canon`, { file, line: i + 1 }));
          continue;
        }
        const cited = [section, ...[...conjuncts.matchAll(BARE_SECTION)].map((conjunct) => conjunct[1] ?? "")];
        for (const number of cited) {
          for (const key of keys) {
            if (sectionsByDoc.get(key)?.has(number)) continue;
            const where = keys.length === 1 ? "that document" : `\`${key}\``;
            findings.push(fail(`\`${doc} §${number}\` does not resolve to a section in ${where}`, { file, line: i + 1 }));
          }
        }
      }

      if (ownSections.size === 0) continue;
      for (const match of bare.matchAll(BARE_SECTION)) {
        const [, section = ""] = match;
        if (!ownSections.has(section)) {
          findings.push(fail(`intra-document \`§${section}\` does not resolve to a section in this file`, { file, line: i + 1 }));
        }
      }
    }

    if (!isNumbered(file)) continue;

    findings.push(...validateFrontmatter(file, source, descriptionMax));
    findings.push(...validatePaths(file, stripped, root));
    findings.push(...validateRotProse(file, stripped));

    const lineCount = source.split("\n").length;
    if (lineCount > sizeFail) findings.push(fail(`${lineCount} lines exceeds the ${sizeFail}-line hard limit — split or cut`, { file }));
    else if (lineCount > sizeWarn) findings.push(warn(`${lineCount} lines exceeds the ${sizeWarn}-line target`, { file }));

    const quickRef = blockAfter(stripped, /^## 0\. /);
    if (quickRef === null) {
      findings.push(warn("no `## 0. Quick Reference` — the document has no section map", { file }));
    } else {
      const listed = new Set([...quickRef.lines.join("\n").matchAll(/§([0-9][A-Za-z0-9]*)/g)].map((match) => match[1]));
      const missing = (parsed.get(file) ?? []).filter((s) => s.number !== "0" && !listed.has(s.number)).map((s) => s.number);
      if (missing.length > 0) findings.push(warn(`Quick Reference omits ${missing.map((n) => `§${n}`).join(", ")}`, { file }));
      findings.push(...validateQuickReferenceAgreement(file, stripped, parsed.get(file) ?? []));
    }
  }

  // Held to this one rule and no other: a gloss that lies reaches every consumer of the corpus.
  const scanned = new Set(files);
  for (const dir of config.agreementDirs ?? []) {
    for (const file of collectFiles(root, dir, (name) => name.endsWith(".md"))) {
      if (scanned.has(file)) continue;
      const lines = stripFences(readFileSync(resolve(root, file), "utf-8"));
      findings.push(...validateQuickReferenceAgreement(file, lines, parseSections(file, lines).sections));
    }
  }

  for (const catalog of catalogs) {
    const source = sources.get(catalog.doc);
    if (source === undefined) continue;
    const citations = findSubpathCitations(source, packageName, { strict: true });
    for (const subpath of uncitedSubpaths(exportSubpaths, citations, new Set(catalog.exempt ?? []))) {
      findings.push(
        fail(`\`${subpath}\` is published by package.json exports but not cited — add a namespace-table row, or exempt it with a rationale`, {
          file: catalog.doc,
        }),
      );
    }
  }

  // A row lists a subpath; a prose rule binds it. Warn, because the backlog this found on the day
  // it was written is a backlog, and a check that fails a build over one gets exempted wholesale.
  for (const subpath of [...exportSubpaths].sort()) {
    if (proseBound.has(subpath) || listedOnly.has(subpath) || documentedNonExports.has(subpath)) continue;
    findings.push(warn(`\`${subpath}\` is listed but bound by no prose rule — add one, or exempt it with a reason`));
  }

  const warnings = findings.filter((finding) => finding.level === "warn").length;
  return checkResult(findings, `${files.length} documents verified, ${warnings} warning${warnings === 1 ? "" : "s"}.`);
}
