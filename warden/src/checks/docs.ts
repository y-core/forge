import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { githubSlug } from "../../../src/tooling/gate/checks/markdown-parse";
import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import type { ExportsMap } from "../../../src/tooling/gate/checks/types";
import { checkResult, fail, scannedNothing, warn } from "../../../src/tooling/gate/finding";
import type { CheckResult, Finding } from "../../../src/tooling/gate/types";
import { findSubpathCitations, quickReference, uncitedSubpaths } from "./docs-parse";

/** The canon tree a directory's documents are read from. @public */
export type DocKind = "libs" | "apps" | "shared";

/** An `extraDirs` entry that declares its readers' tree. @public */
export interface ExtraDir {
  /** Directory relative to `root`, or one `.md` document. */
  dir: string;
  /** The tree its readers stand in; omitted where they read this repository's own documents. */
  kind?: DocKind;
  /** Whether its documents are numbered governing prose, held to the full `decisionsDir` format. */
  numbered?: boolean;
}

/** A `citableDirs` entry that states the prefix its documents are cited under. @public */
export interface CitableDir {
  /** Directory relative to `root`. */
  dir: string;
  /** The one segment a citation spells before the filename, in place of the directory's own name. */
  as: string;
}

/** What the docs check needs to know about the project. @public */
export interface DocsCheckConfig {
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
  /** The canon tree this repository's own documents read from — `libs` for a library, `apps` for an application. */
  kind?: DocKind;
  /** Extra directories of markdown held to the prose rules, relative to `root`. */
  extraDirs?: readonly (string | ExtraDir)[];
  /** Directories of numbered documents this repository cites but does not own — the fleet canon. */
  citableDirs?: readonly (string | CitableDir)[];
  /** Source root walked for `README.md` files, relative to `root`. Defaults to `src`. */
  sourceDir?: string;
  /** Subpaths a document may name despite their absence from the exports map. */
  documentedNonExports?: readonly string[];
  /** Published subpaths the front page is licensed *not* to cite. */
  tableExemptSubpaths?: readonly string[];
  /** Documents that must enumerate every published subpath, each with its own exemptions. */
  catalogs?: readonly { doc: string; exempt?: readonly string[] }[];
  /** Published subpaths licensed to be listed in a table and bound by no prose rule. */
  listedOnlySubpaths?: readonly string[];
  /** Line count above which a governing document warns. Defaults to 600. */
  sizeWarn?: number;
  /** Line count above which it fails. Defaults to 800. */
  sizeFail?: number;
  /** Maximum frontmatter `description` length. Defaults to 200. */
  descriptionMax?: number;
  /** Extra frontmatter keys a directory's documents must carry, each with the values it may take. */
  requiredFrontmatter?: readonly FrontmatterRule[];
  /** Directories held to Quick Reference agreement and nothing else. */
  agreementDirs?: string[];
}

interface Section {
  number: string;
  title: string;
  level: number;
  line: number;
}

// The tail is what closes the link around the document name — `)` inline, `][id]` by reference —
// and neither is required, because a bare `X.md §N` in prose is a citation too.
const INTER_DOC_CITATION =
  /((?:[A-Za-z0-9_-]+\/)?[A-Z_]+\.md)`?(?:\]\[[^\]]+\]|\))?\s+§([0-9][A-Za-z0-9]*)((?:(?:,|\s+and|\s+or)\s+§[0-9][A-Za-z0-9]*)*)/g;
const LINE_FINAL_DOC_LINK = /(?:\]\([^()]*[A-Z_]+\.md\)|\[[^\]]*[A-Z_]+\.md`?\]\[[^\]]+\])`?\s*$/;
const LEADING_SECTION = /^\s*§[0-9][A-Za-z0-9]*/;
const BARE_SECTION = /§([0-9][A-Za-z0-9]*)/g;
const BACKTICKED_PATH = /`((?:src|config|\.claude)\/[^`]*)`/g;
const UNRESOLVABLE_PATH = /[*<{…\s]/;
const ROT_PROSE =
  /\b(previously|no longer|used to|formerly|renamed from|fixed by|has since|any ?more|it once|as of version|since v0\.|was called|old API|superseded by|replaced all|remains compatible|for compatibility|historically|originally|what changed is|was rejected|was considered and deferred|was split out of|the \S+ sweep)\b/i;
const COUNT_WORD = "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
const COUNT_ABOVE_A_PAIR = "three|four|five|six|seven|eight|nine|ten|eleven|twelve";
const DETERMINER = "the|its|their|our|these|those|same";
const LEAD = `(?:^|[.!?]\\s+|\\|\\s*|^\\s*(?:[-*+]|\\d+[.)])\\s+|[—–]\\s*)[*_>'\\s]*`;

// A definite count is the tally, an indefinite one a rule about arity. `two` is held to a lead
// position alone: `the two X` is near-always a back-reference to a pair the sentence just named.
const TALLY = new RegExp(
  `(?<!\\b(?:least|most|than|every|up to)\\s)(?:(?:there\\s+(?:are|were)|one\\s+of\\s+the)\\s+(?:${COUNT_WORD})\\b` +
    `|(?:(?<=\\b(?:${DETERMINER})\\s)(?:${COUNT_ABOVE_A_PAIR})|(?<=${LEAD})(?:${COUNT_WORD}))` +
    `\\s+(?:[A-Za-z][A-Za-z-]*\\s+){0,2}([A-Za-z][A-Za-z-]{2,}s)\\b)`,
  "i",
);

/** `two or three pixels` is an approximation, and the unit nouns are measures rather than a population. */
const APPROXIMATION = new RegExp(`\\b(?:${COUNT_WORD})\\s+or\\s+`, "i");

/** The items themselves, following the count on the same line — the argument that the set is closed. */
const ENUMERATION = /^(?:\s+[A-Za-z][A-Za-z-]*){0,3}\s*[—–:(]/;
const UNIT_NOUN = new Set([
  "pixels",
  "units",
  "bytes",
  "bits",
  "digits",
  "characters",
  "columns",
  "times",
  "seconds",
  "milliseconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "years",
]);
const NOT_A_PLURAL = new Set([
  "always",
  "perhaps",
  "thus",
  "less",
  "plus",
  "was",
  "has",
  "does",
  "its",
  "this",
  "else",
  "unless",
  "across",
  "versus",
  "whereas",
]);
const HEADING_LINE = /^#{1,6}[ \t]/;
const QUICK_REFERENCE_HEADING = /^##[ \t]+0\./;
const INLINE_CODE = /`[^`]*`/g;
const QUOTED_SPAN = /"[^"]*"|“[^”]*”/g;
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g;

const LIST_MARKER = /^ {0,3}(?:[-*+]|\d+[.)])\s/;
const LINK_DEFINITION = /^ {0,3}\[([^\]]+)\]:[ \t]+(\S+)/;
const REFERENCE_USE = /\]\[([^\]]+)\]/g;
const INLINE_HREF = /\]\(([^)\s]+)\)/g;
const ABSOLUTE_HREF = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/;
const ATX_HEADING = /^#{1,6}[ \t]+(.+?)[ \t]*$/;

/** Every `[id]: destination` a document defines, keyed by the id a reference use writes. @public */
export function linkDefinitions(lines: readonly string[]): Map<string, { destination: string; line: number }> {
  const out = new Map<string, { destination: string; line: number }>();
  for (let i = 0; i < lines.length; i++) {
    const match = (lines[i] ?? "").match(LINK_DEFINITION);
    if (match) out.set((match[1] ?? "").toLowerCase(), { destination: match[2] ?? "", line: i + 1 });
  }
  return out;
}

/** Strip fenced and indented code blocks, leaving the line count intact so reported line numbers stay true. @public */
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

/** Calendar dates, ticket identifiers and inventory counts — a governing document carries no history and no tally. @public */
export function validateNoRot(file: string, lines: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  let inQuickReference = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const date = line.match(/\d{4}-\d{2}-\d{2}/);
    if (date) findings.push(fail(`calendar date \`${date[0]}\` — governing docs carry no history`, { file, line: i + 1 }));
    const ticket = line.match(/\b[A-Z]{1,3}\d+-\d+(?:\.\d+)*\b/);
    if (ticket) findings.push(fail(`ticket identifier \`${ticket[0]}\` — governing docs carry no task IDs`, { file, line: i + 1 }));

    // A heading is an anchor other documents cite, and its Quick Reference line mirrors it word for
    // word; renaming either to drop a count is a coordinated break for no gain.
    const heading = HEADING_LINE.test(line);
    if (heading) inQuickReference = QUICK_REFERENCE_HEADING.test(line);
    if (heading || inQuickReference) continue;

    // A count inside quotation marks is a mention rather than a claim about the system, wherever in
    // the sentence it sits — the shape a rule takes when it quotes the spellings it forbids.
    const prose = line.replace(INLINE_CODE, " ").replace(QUOTED_SPAN, " ");
    const tally = prose.match(TALLY);
    const noun = (tally?.[1] ?? "").toLowerCase();
    // `There are two flag types — "boolean" and "string"` names the members it counts, which is the
    // argument that the set is closed; the count is then the rule rather than a tally of it.
    const argued = tally !== null && tally[1] === undefined && ENUMERATION.test(prose.slice((tally.index ?? 0) + tally[0].length));
    if (tally && !argued && !NOT_A_PLURAL.has(noun) && !UNIT_NOUN.has(noun) && !APPROXIMATION.test(tally[0])) {
      findings.push(fail(`inventory count \`${tally[0]}\` — a governing doc records that a thing exists, not how many`, { file, line: i + 1 }));
    }
  }
  return findings;
}

/** A title flattened for comparison: links to their text, backticks and case dropped, whitespace collapsed, trailing parenthetical removed. */
function flattenTitle(text: string): string {
  return text
    .replace(INLINE_LINK, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .toLowerCase();
}

/** The phrase a title leads with, up to the punctuation that starts its qualifier. */
function leadPhrase(text: string): string {
  return (flattenTitle(text).split(/\s+—\s+|\s+–\s+|:|;|,/)[0] ?? "").trim();
}

/** Every Quick Reference line must still name the heading it summarises. */
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

/** A backticked list read as a sentence — `a`, `b` and `c`. */
function listOf(values: readonly string[]): string {
  const quoted = values.map((value) => `\`${value}\``);
  const last = quoted.pop() ?? "";
  return quoted.length === 0 ? last : `${quoted.join(", ")} and ${last}`;
}

/** An extra frontmatter key a directory's documents must carry, and what it may say. @public */
export interface FrontmatterRule {
  /** Directory relative to `root`, or one `.md` document. */
  dir: string;
  /** The key that must be present. */
  key: string;
  /** The values it may take, and nothing else. */
  values: readonly string[];
}

/** Frontmatter presence and shape. @public */
export function validateFrontmatter(
  file: string,
  source: string,
  descriptionMax: number,
  required: readonly Omit<FrontmatterRule, "dir">[] = [],
): Finding[] {
  if (!source.startsWith("---\n")) return [fail("missing YAML frontmatter", { file })];
  const end = source.indexOf("\n---", 4);
  if (end === -1) return [fail("unterminated YAML frontmatter", { file })];

  const block = source.slice(4, end);
  const findings: Finding[] = [];

  const allowed = new Set(["title", "description", ...required.map((rule) => rule.key)]);
  for (const match of block.matchAll(/^([A-Za-z][A-Za-z0-9_-]*):/gm)) {
    const [, key = ""] = match;
    if (!allowed.has(key)) {
      findings.push(fail(`unexpected frontmatter key \`${key}\` — ${listOf([...allowed])} only`, { file }));
    }
  }

  for (const rule of required) {
    const value = block
      .match(new RegExp(`^${rule.key}:\\s*(.+)$`, "m"))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (value === undefined || value === "") {
      findings.push(fail(`frontmatter is missing \`${rule.key}\` — one of ${listOf(rule.values)}`, { file }));
    } else if (!rule.values.includes(value)) {
      findings.push(fail(`frontmatter \`${rule.key}: ${value}\` is not one of ${listOf(rule.values)}`, { file }));
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

  // Sections here are not registered as citation targets: a `citableDirs` entry already keys those
  // by tree, and a second bare key would displace them.
  const isNumbered = (file: string): boolean =>
    file.startsWith(`${decisionsDir}/`) || extraDirs.some(({ dir, numbered }) => numbered === true && (file === dir || file.startsWith(`${dir}/`)));

  const isStrict = (file: string): boolean => isGoverning(file) || file === rootReadme;

  /** Whether a document belongs to a cited tree — written elsewhere, and overwritten here on sync. */
  const isCited = (file: string): boolean =>
    (config.citableDirs ?? []).some((entry) => {
      const dir = typeof entry === "string" ? entry : entry.dir;
      return file === dir || file.startsWith(`${dir}/`);
    });

  // Which extra frontmatter keys this file owes, by the directory it sits in. A file under no rule
  // owes none and may carry none — the allowed-key set is closed either way.
  const frontmatterRules = (file: string): Omit<FrontmatterRule, "dir">[] =>
    (config.requiredFrontmatter ?? [])
      .filter((rule) => file === rule.dir || file.startsWith(`${rule.dir}/`))
      .map(({ key, values }) => ({ key, values }));

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

  // Without a citable root, a citation into a document outside `decisionsDir` resolves to no key and
  // is skipped in silence — a whole tree of rules stops being checked.
  const citableDirs = (config.citableDirs ?? []).map((entry) => (typeof entry === "string" ? { dir: entry } : entry)) as {
    dir: string;
    as?: string;
  }[];
  const docRoots = [
    { base: decisionsPath, prefix: "" },
    ...citableDirs.map(({ dir, as }) =>
      as === undefined ? { base: dirname(resolve(root, dir)), prefix: "" } : { base: resolve(root, dir), prefix: `${as}/` },
    ),
  ];
  for (const { dir, as } of citableDirs) {
    // `relative` rather than a slice off `dir`: a `../`-prefixed linked checkout makes the caller's
    // spelling and `collectFiles`' output disagree byte for byte.
    const base = as === undefined ? dirname(dir) : resolve(root, dir);
    for (const file of collectFiles(root, dir, (name) => name.endsWith(".md"))) {
      const { sections } = parseSections(file, stripFences(readFileSync(resolve(root, file), "utf-8")));
      const key = as === undefined ? file.slice(base.length + 1) : `${as}/${relative(base, resolve(root, file))}`;
      sectionsByDoc.set(key, new Set(sections.map((section) => section.number)));
    }
  }

  const definitionCache = new Map<string, Map<string, { destination: string; line: number }>>();
  const definitionsOf = (file: string): Map<string, { destination: string; line: number }> => {
    const held = definitionCache.get(file);
    if (held !== undefined) return held;
    const built = linkDefinitions(stripFences(sources.get(file) ?? readFileSync(resolve(root, file), "utf-8")));
    definitionCache.set(file, built);
    return built;
  };

  // Under reference style the line carries an id and the destination sits in the definition block,
  // so a check reading only the line sees no path at all.
  const hrefsOn = (file: string, line: string): string[] => {
    const out: string[] = [];
    for (const match of line.matchAll(/\]\((\.{0,2}\/?[A-Za-z0-9._\-/]+\.md)(?:#[^)\s]*)?\)/g)) out.push(match[1] ?? "");
    const definitions = definitionsOf(file);
    for (const match of line.matchAll(REFERENCE_USE)) {
      const destination = definitions.get((match[1] ?? "").toLowerCase())?.destination;
      if (destination !== undefined) out.push(destination.split("#")[0] ?? "");
    }
    return out;
  };

  const headingCache = new Map<string, Set<string>>();
  const slugsOf = (path: string): Set<string> => {
    const held = headingCache.get(path);
    if (held !== undefined) return held;
    const slugs = new Set(
      stripFences(readFileSync(path, "utf-8"))
        .map((line) => line.match(ATX_HEADING)?.[1])
        .filter((title) => title !== undefined)
        .map((title) => githubSlug(title)),
    );
    headingCache.set(path, slugs);
    return slugs;
  };

  // Keys are `subdir/DOC.md` once the tree nests, but a citation may name either form. A same-line
  // link resolves it exactly; a bare basename is settled by where the citing file sits.
  const docKeys = [...sectionsByDoc.keys()];
  const resolveDocKey = (file: string, cited: string, line: string): { keys?: string[]; ambiguous?: string[] } => {
    for (const href of hrefsOn(file, line)) {
      if (href !== cited && !href.endsWith(`/${cited}`)) continue;
      const target = resolve(dirname(resolve(root, file)), href);
      for (const { base, prefix } of docRoots) {
        const within = relative(base, target);
        const key = `${prefix}${within}`;
        if (!within.startsWith("..") && sectionsByDoc.has(key)) return { keys: [key] };
      }
    }

    // The canon names a reader's own `docs/X.md` in prose (`AGENT_GUIDE.md` §5d); the key is stored
    // relative to the decisions directory, so the prefix has to come off before the name can match.
    const local = cited.startsWith(`${decisionsDir}/`);
    const name = local ? cited.slice(decisionsDir.length + 1) : cited;
    const matches = docKeys.filter((key) => (local ? key === name : key === name || key.endsWith(`/${name}`)));
    if (matches.length === 0) return {};
    if (matches.length === 1) return { keys: matches };

    const settle = (candidates: string[]): { keys: string[] } | undefined => (candidates.length === 1 ? { keys: candidates } : undefined);
    const declared = declaredKindOf(file);
    const kind = declared ?? config.kind;

    // A document of this repository's own means this repository's own document first. Falling
    // through is a citation into the canon, read at this repository's own kind.
    if (declared === undefined) {
      const own = settle(matches.filter((key) => !key.includes("/")));
      if (own !== undefined) return own;
    }
    if (kind === undefined) return { ambiguous: matches };

    // A reader scoped to one kind means their own tree, and `shared` where that tree has no such
    // document — the only trees a consumer of that kind is ever shipped.
    if (kind !== "shared") {
      return (
        settle(matches.filter((key) => key.startsWith(`${kind}/`))) ??
        settle(matches.filter((key) => key.startsWith("shared/"))) ?? { ambiguous: matches }
      );
    }

    // A `shared` document is read by every kind at once, so no single tree is the one it meant; it
    // resolves only when every tree carrying the filename carries the section too.
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
    if (!isCited(file)) findings.push(...validateRotProse(file, stripped));

    const ownSections = new Set((parsed.get(file) ?? []).map((section) => section.number));
    const fileDir = dirname(resolve(root, file));
    const definitions = definitionsOf(file);
    const usedIds = new Set<string>();

    // A path was resolved and its `#anchor` thrown away, so a link could name a real document at a
    // heading that is not in it — the exact rot a per-section citation introduces at scale.
    const targetFindings = (spelling: string, at: number): Finding[] => {
      if (ABSOLUTE_HREF.test(spelling)) return [];
      const hash = spelling.indexOf("#");
      const path = hash === -1 ? spelling : spelling.slice(0, hash);
      const anchor = hash === -1 ? undefined : spelling.slice(hash + 1);
      const target = path === "" ? resolve(root, file) : resolve(fileDir, path);
      if (!existsSync(target)) return [fail(`link target \`${path}\` does not exist`, { file, line: at })];
      if (anchor === undefined || anchor === "" || !target.endsWith(".md")) return [];
      if (slugsOf(target).has(anchor)) return [];
      return [fail(`\`#${anchor}\` names no heading in \`${path === "" ? "this file" : path}\``, { file, line: at })];
    };

    // A citation wrapped across a line break is one citation: the link ends a line and its §N opens
    // the next, so the pair is matched joined and the continuation's §N is not a bare token.
    const wrappedContinuations = new Set<number>();
    for (let i = 0; i < stripped.length - 1; i++) {
      if (LINE_FINAL_DOC_LINK.test(stripped[i] ?? "") && LEADING_SECTION.test(stripped[i + 1] ?? "")) wrappedContinuations.add(i + 1);
    }

    for (let i = 0; i < stripped.length; i++) {
      const line = stripped[i];
      if (line === undefined) continue;

      for (const match of line.matchAll(INLINE_HREF)) findings.push(...targetFindings(match[1] ?? "", i + 1));

      // Scanned with the code spans blanked: `theme[a][b]` in backticks is a property path, and
      // reading it as a reference use reports an id nobody wrote.
      for (const match of line.replace(INLINE_CODE, " ").matchAll(REFERENCE_USE)) {
        const id = (match[1] ?? "").toLowerCase();
        if (definitions.has(id)) usedIds.add(id);
        else findings.push(fail(`\`[${id}]\` is used as a link but nothing defines it`, { file, line: i + 1 }));
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

    // An unused definition is silent rot: the path it names goes on being resolved, so every other
    // check stays green while the link the definition was written for is gone.
    for (const [id, definition] of definitions) {
      if (usedIds.has(id)) findings.push(...targetFindings(definition.destination, definition.line));
      else findings.push(fail(`link definition \`[${id}]\` is never used`, { file, line: definition.line }));
    }

    if (!isNumbered(file)) continue;

    findings.push(...validateFrontmatter(file, source, descriptionMax, frontmatterRules(file)));
    findings.push(...validatePaths(file, stripped, root));

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

  // A row lists a subpath; a prose rule binds it. A failure now the backlog is empty — the warning
  // was for working the list down, and holding it there would let the next subpath ship unbound.
  for (const subpath of [...exportSubpaths].sort()) {
    if (proseBound.has(subpath) || listedOnly.has(subpath) || documentedNonExports.has(subpath)) continue;
    findings.push(fail(`\`${subpath}\` is listed but bound by no prose rule — add one, or exempt it with a reason`));
  }

  const warnings = findings.filter((finding) => finding.level === "warn").length;
  return checkResult(findings, `${files.length} documents verified, ${warnings} warning${warnings === 1 ? "" : "s"}.`);
}
