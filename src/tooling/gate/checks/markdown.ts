import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { type CheckResult, checkResult, type Finding, scannedNothing } from "../finding";
import { type MarkdownRules, parseMarkdown, renderMarkdown, validateMarkdown } from "./markdown-parse";
import { excludedBy, resolveSources } from "./source-scan";

/** What the markdown check needs to know about the project. @public */
export interface MarkdownCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** Files and directories to scan, relative to `root`; a `!`-prefixed entry excludes a subtree. Defaults to `["src"]`. */
  sources?: readonly string[];
  /** Further subtrees or files to exclude — generated trees another tool owns the bytes of. */
  exclude?: readonly string[];
  /** Overrides of the house conventions; every key is optional. */
  rules?: MarkdownRules;
}

const MARKDOWN = (name: string): boolean => name.endsWith(".md");

/** Every markdown file the config points at, repo-relative, deduped and sorted. @public */
export function resolveMarkdownFiles(config: MarkdownCheckConfig): string[] {
  const sources = config.sources ?? ["src"];
  return resolveSources(config.root, sources, MARKDOWN).filter((file) => !excludedBy(file, config.exclude ?? []));
}

/** Hold every markdown file to the house conventions. Reports; writes nothing. @public */
export function checkMarkdown(config: MarkdownCheckConfig): CheckResult {
  const files = resolveMarkdownFiles(config);
  if (files.length === 0) return scannedNothing(`\`${(config.sources ?? ["src"]).join("`, `")}\` matched no markdown file`, "markdown");

  const findings: Finding[] = [];
  for (const file of files) {
    const source = readFileSync(resolve(config.root, file), "utf-8");
    findings.push(...validateMarkdown(file, parseMarkdown(source), config.rules));
  }
  const fixable = findings.filter((finding) => finding.level === "fail").length;
  return checkResult(findings, `${files.length} markdown files scanned, ${fixable} findings — \`bun run fix\` applies the mechanical ones.`);
}

/** Apply the mechanical rules in place, writing only the files whose bytes changed. @public */
export function fixMarkdown(config: MarkdownCheckConfig): void {
  for (const file of resolveMarkdownFiles(config)) {
    const path = resolve(config.root, file);
    const source = readFileSync(path, "utf-8");
    const rendered = renderMarkdown(parseMarkdown(source), config.rules);
    if (rendered !== source) writeFileSync(path, rendered, "utf-8");
  }
}
