import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type CheckResult, checkResult, type Finding, fail, warn } from "../finding";
import { findSubpathCitations, uncitedSubpaths } from "./docs-parse";
import type { ExportsMap } from "./exports";

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

/** Strip fenced code blocks, leaving the line count intact so reported line numbers stay true. @public */
export function stripFences(source: string): string[] {
  let inFence = false;
  return source.split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return "";
    }
    if (inFence) return "";
    if (/^ {4,}\S/.test(line)) return "";
    return line;
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
    if (/^## /.test(lines[i] ?? "")) {
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

/** Frontmatter presence and shape. @public */
export function validateFrontmatter(file: string, source: string, descriptionMax: number): Finding[] {
  if (!source.startsWith("---\n")) return [fail("missing YAML frontmatter", { file })];
  const end = source.indexOf("\n---", 4);
  if (end === -1) return [fail("unterminated YAML frontmatter", { file })];

  const block = source.slice(4, end);
  const findings: Finding[] = [];

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
    for (const entry of readdirSync(decisionsPath)) if (entry.endsWith(".md")) files.push(join(decisionsDir, entry));
  }
  if (existsSync(resolve(root, guideIndexOwner))) files.push(guideIndexOwner);
  if (existsSync(resolve(root, rootReadme))) files.push(rootReadme);
  for (const dir of config.extraDirs ?? []) {
    const abs = resolve(root, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) if (entry.endsWith(".md")) files.push(join(dir, entry));
  }
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === "README.md") files.push(relative(root, full));
    }
  };
  if (existsSync(resolve(root, sourceDir))) walk(resolve(root, sourceDir));
  files.sort();

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
    for (let i = 0; i < stripped.length; i++) {
      const line = stripped[i];
      if (line === undefined) continue;

      for (const match of line.matchAll(/\]\((\.{0,2}\/?[A-Za-z0-9._\-/]+\.md)(?:#[A-Za-z0-9-]+)?\)/g)) {
        const [, href = ""] = match;
        if (!existsSync(resolve(fileDir, href))) findings.push(fail(`link target \`${href}\` does not exist`, { file, line: i + 1 }));
      }

      for (const match of line.matchAll(/([A-Z_]+\.md)`?\)?\s+§([0-9][A-Za-z0-9]*)/g)) {
        const [, doc = "", section = ""] = match;
        const known = sectionsByDoc.get(doc);
        if (known === undefined) continue;
        if (!known.has(section)) {
          findings.push(fail(`\`${doc} §${section}\` does not resolve to a section in that document`, { file, line: i + 1 }));
        }
      }

      if (/[A-Z_]+\.md/.test(line) || ownSections.size === 0) continue;
      for (const match of line.matchAll(/§([0-9][A-Za-z0-9]*)/g)) {
        const [, section = ""] = match;
        if (!ownSections.has(section)) {
          findings.push(fail(`intra-document \`§${section}\` does not resolve to a section in this file`, { file, line: i + 1 }));
        }
      }
    }

    if (!file.startsWith(`${decisionsDir}/`)) continue;

    findings.push(...validateFrontmatter(file, source, descriptionMax));

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
      const linkRe = new RegExp(`\\]\\((?:\\./)?${decisionsDir}/([A-Za-z0-9_]+\\.md)\\)`, "g");
      for (const line of block.lines) {
        for (const match of line.matchAll(linkRe)) {
          const [, doc = ""] = match;
          indexed.add(doc);
          if (!existsSync(resolve(decisionsPath, doc))) {
            findings.push(fail(`Guide Index names \`${doc}\`, which does not exist`, { file: guideIndexOwner }));
          }
        }
      }
      for (const doc of [...sectionsByDoc.keys()].sort()) {
        if (!indexed.has(doc)) {
          findings.push(fail(`\`${decisionsDir}/${doc}\` is not registered in the Guide Index`, { file: guideIndexOwner }));
        }
      }
    }
  }

  const warnings = findings.filter((finding) => finding.level === "warn").length;
  return checkResult(findings, `${files.length} documents verified, ${warnings} warning${warnings === 1 ? "" : "s"}.`);
}
