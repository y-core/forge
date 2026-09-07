import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import type { ExportsMap } from "../../../src/tooling/gate/checks/exports";
import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import { type CheckResult, checkResult, type Finding, fail, scannedNothing, warn } from "../../../src/tooling/gate/finding";
import { findSubpathCitations, uncitedSubpaths } from "./docs-parse";

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
  /** Extra directories of markdown held to the prose rules, relative to `root`. */
  extraDirs?: readonly string[];
  /** Directories of numbered documents this repository cites but does not own — the fleet canon.
   *  Their sections resolve a citation; they are not themselves validated or index-reconciled.
   *  Each is keyed by its own directory name, so `libs/TESTING.md` cannot silently displace the
   *  `TESTING.md` this repository owns — a bare citation naming both is reported ambiguous. */
  citableDirs?: readonly string[];
  /** Source root walked for `README.md` files, relative to `root`. Defaults to `src`. */
  sourceDir?: string;
  /** Subpaths a document may name despite their absence from the exports map. */
  documentedNonExports?: readonly string[];
  /** Published subpaths the front page is licensed *not* to cite. */
  tableExemptSubpaths?: readonly string[];
  /** Line count above which a governing document warns. Defaults to 600. */
  sizeWarn?: number;
  /** Line count above which it fails. Defaults to 800. */
  sizeFail?: number;
  /** Maximum frontmatter `description` length. Defaults to 200. */
  descriptionMax?: number;
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

/** Prose narrating a change — a governing document describes only the present. */
function warnRotProse(file: string, lines: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]?.replace(INLINE_CODE, " ").match(ROT_PROSE);
    if (match) findings.push(warn(`historical phrasing \`${match[0]}\` — governing docs carry no history`, { file, line: i + 1 }));
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
  const tableExempt = new Set(config.tableExemptSubpaths ?? []);

  const findings: Finding[] = [];

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
  for (const dir of config.extraDirs ?? []) {
    files.push(...collectFiles(root, dir, (name) => name.endsWith(".md")));
  }
  files.push(...collectFiles(root, sourceDir, (name) => name === "README.md"));
  files.sort();

  if (files.length === 0)
    return scannedNothing(`\`${decisionsDir}\`, \`${guideIndexOwner}\`, \`${rootReadme}\` and \`${sourceDir}\` hold no document`, "docs", "read");

  const isGoverning = (file: string): boolean =>
    file.startsWith(`${decisionsDir}/`) || file === guideIndexOwner || (config.extraDirs ?? []).some((dir) => file.startsWith(`${dir}/`));

  const isStrict = (file: string): boolean => isGoverning(file) || file === rootReadme;

  const sources = new Map<string, string>();
  const sectionsByDoc = new Map<string, Set<string>>();
  const parsed = new Map<string, Section[]>();

  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf-8");
    sources.set(file, source);
    if (!file.startsWith(`${decisionsDir}/`)) continue;
    const { sections, findings: sectionFindings } = parseSections(file, stripFences(source));
    findings.push(...sectionFindings);
    parsed.set(file, sections);
    sectionsByDoc.set(file.slice(decisionsDir.length + 1), new Set(sections.map((section) => section.number)));
  }

  // A citable root registers its sections and nothing else. Without one, a citation into a document
  // outside `decisionsDir` resolves to no key and is skipped in silence — which is how a whole tree
  // of rules stops being checked the moment it moves out from under this directory.
  const ownedDocs = [...sectionsByDoc.keys()];
  const docRoots = [decisionsPath, ...(config.citableDirs ?? []).map((dir) => dirname(resolve(root, dir)))];
  for (const dir of config.citableDirs ?? []) {
    const base = dirname(dir);
    for (const file of collectFiles(root, dir, (name) => name.endsWith(".md"))) {
      const { sections } = parseSections(file, stripFences(readFileSync(resolve(root, file), "utf-8")));
      sectionsByDoc.set(file.slice(base.length + 1), new Set(sections.map((section) => section.number)));
    }
  }

  // Keys are `subdir/DOC.md` once the tree nests, but a citation may name either form. A same-line
  // link resolves it exactly; a bare basename resolves only while it names one document.
  const docKeys = [...sectionsByDoc.keys()];
  const resolveDocKey = (file: string, cited: string, line: string): { key?: string; ambiguous?: string[] } => {
    for (const match of line.matchAll(/\]\((\.{0,2}\/?[A-Za-z0-9._\-/]+\.md)\)/g)) {
      const [, href = ""] = match;
      if (href !== cited && !href.endsWith(`/${cited}`)) continue;
      const target = resolve(dirname(resolve(root, file)), href);
      for (const base of docRoots) {
        const key = relative(base, target);
        if (!key.startsWith("..") && sectionsByDoc.has(key)) return { key };
      }
    }
    const matches = docKeys.filter((key) => key === cited || key.endsWith(`/${cited}`));
    const only = matches[0];
    if (matches.length === 1 && only !== undefined) return { key: only };
    if (matches.length > 1) return { ambiguous: matches };
    return {};
  };

  for (const file of files) {
    const source = sources.get(file) ?? "";
    const stripped = stripFences(source);

    for (const { line, raw, subpath } of findSubpathCitations(source, packageName, { strict: isStrict(file) })) {
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
        const { key, ambiguous } = resolveDocKey(file, doc, citationLine);
        if (ambiguous !== undefined) {
          findings.push(fail(`\`${doc} §${section}\` is ambiguous — ${ambiguous.join(" and ")} both match; cite the path`, { file, line: i + 1 }));
          continue;
        }
        if (key === undefined) continue;
        const cited = [section, ...[...conjuncts.matchAll(BARE_SECTION)].map((conjunct) => conjunct[1] ?? "")];
        for (const number of cited) {
          if (!sectionsByDoc.get(key)?.has(number)) {
            findings.push(fail(`\`${doc} §${number}\` does not resolve to a section in that document`, { file, line: i + 1 }));
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

    if (!file.startsWith(`${decisionsDir}/`)) continue;

    findings.push(...validateFrontmatter(file, source, descriptionMax));
    findings.push(...validatePaths(file, stripped, root));
    findings.push(...warnRotProse(file, stripped));

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
    }
  }

  const readmeSource = sources.get(rootReadme);
  if (readmeSource !== undefined) {
    const citations = findSubpathCitations(readmeSource, packageName, { strict: true });
    for (const subpath of uncitedSubpaths(exportSubpaths, citations, tableExempt)) {
      findings.push(
        fail(`\`${subpath}\` is published by package.json exports but not cited — add a namespace-table row, or exempt it with a rationale`, {
          file: rootReadme,
        }),
      );
    }
  }

  const indexPath = resolve(root, guideIndexOwner);
  if (existsSync(indexPath)) {
    const lines = readFileSync(indexPath, "utf-8").split("\n");
    const block = blockAfter(lines, /^## Guide Index/);
    if (block === null) {
      findings.push(fail("no `## Guide Index` section", { file: guideIndexOwner }));
    } else {
      const indexed = new Set<string>();
      const linkRe = new RegExp(`\\]\\((?:\\./)?${decisionsDir}/((?:[A-Za-z0-9_-]+/)?[A-Za-z0-9_]+\\.md)\\)`, "g");
      for (const line of block.lines) {
        for (const match of line.matchAll(linkRe)) {
          const [, doc = ""] = match;
          indexed.add(doc);
          if (!existsSync(resolve(decisionsPath, doc))) {
            findings.push(fail(`Guide Index names \`${doc}\`, which does not exist`, { file: guideIndexOwner }));
          }
        }
      }
      for (const doc of [...ownedDocs].sort()) {
        if (!indexed.has(doc)) {
          findings.push(fail(`\`${decisionsDir}/${doc}\` is not registered in the Guide Index`, { file: guideIndexOwner }));
        }
      }
    }
  }

  const warnings = findings.filter((finding) => finding.level === "warn").length;
  return checkResult(findings, `${files.length} documents verified, ${warnings} warning${warnings === 1 ? "" : "s"}.`);
}
