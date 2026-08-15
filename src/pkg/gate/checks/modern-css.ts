import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { type CheckResult, checkResult, type Finding, fail, warn } from "../finding";
import { type DeferredFinding, MODERN_CSS_DEFERRED } from "./modern-css-deferred";
import { findModernCssViolations, type ModernCssFinding } from "./modern-css-parse";
import { MODERN_CSS_RULES, modernCssRule } from "./modern-css-rules";
import { findModernCssSourceViolations } from "./modern-css-source-parse";

/** What the modern-CSS check needs to know about the project. @public */
export interface ModernCssCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** Files and directories to scan, relative to `root`; a `!`-prefixed entry excludes a subtree. */
  sources: readonly string[];
  /** The shrink-only deferral list. Defaults to forge's own, which a consuming app replaces. */
  deferred?: readonly DeferredFinding[];
}

const SCANNED = (name: string): boolean => /\.(?:css|scss|sass|tsx?)$/.test(name);

const SKIPPED = (name: string): boolean => /\.test\.tsx?$/.test(name) || /\.browser\.tsx?$/.test(name);

const PREPROCESSED = (name: string): boolean => /\.(?:scss|sass)$/.test(name);

function collect(root: string, source: string, into: string[]): void {
  const base = resolve(root, source);
  if (!existsSync(base)) return;
  if (statSync(base).isFile()) {
    if (SCANNED(base) && !SKIPPED(base)) into.push(relative(root, base));
    return;
  }
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const full = resolve(base, entry.name);
    if (entry.isDirectory()) collect(root, relative(root, full), into);
    else if (entry.isFile() && SCANNED(entry.name) && !SKIPPED(entry.name)) into.push(relative(root, full));
  }
}

function covers(entry: DeferredFinding, finding: ModernCssFinding): boolean {
  return entry.ruleId === finding.ruleId && (finding.file === entry.path || finding.file.startsWith(`${entry.path}/`));
}

/** Run every Tier A rule over the configured sources. @public */
export function checkModernCss(config: ModernCssCheckConfig): CheckResult {
  const { root, sources } = config;
  const deferrals = config.deferred ?? MODERN_CSS_DEFERRED;
  const owned = deferrals.filter((entry) => entry.owner.trim() !== "");
  const excluded = sources.filter((source) => source.startsWith("!")).map((source) => source.slice(1));
  const collected: string[] = [];
  for (const source of sources) {
    if (source.startsWith("!")) continue;
    collect(root, source, collected);
  }
  const files = [...new Set(collected)].filter((file) => !excluded.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))).sort();

  if (files.length === 0) {
    return checkResult(
      [fail(`\`${sources.join("`, `")}\` matched no stylesheet or source — refusing to report a green modern-CSS gate that scanned nothing`)],
      "",
    );
  }

  const read = (file: string): string => readFileSync(resolve(root, file), "utf-8");
  // A preprocessor stylesheet is only ever reported for being one, so no textual rule reads it.
  const violations = files.filter((file) => !PREPROCESSED(file)).flatMap((file) => findModernCssViolations(read(file), file));
  const adoption = files.flatMap((file) => findModernCssSourceViolations(read(file), file));
  const findings: Finding[] = [];
  let deferred = 0;

  for (const violation of violations) {
    if (owned.some((entry) => covers(entry, violation))) {
      deferred += 1;
      continue;
    }
    const rule = modernCssRule(violation.ruleId);
    const message = `${violation.ruleId}: ${violation.detail} (${rule.corpus})`;
    findings.push((rule.severity === "fail" ? fail : warn)(message, { file: violation.file, line: violation.line }));
  }

  for (const violation of adoption) {
    const rule = modernCssRule(violation.ruleId);
    findings.push(warn(`${violation.ruleId}: ${violation.detail} (${rule.corpus})`, { file: violation.file, line: violation.line }));
  }

  for (const entry of deferrals) {
    if (entry.owner.trim() === "") {
      findings.push(fail(`\`${entry.path}\` defers \`${entry.ruleId}\` with no owner — a deferral names the task that closes it`));
      continue;
    }
    if (violations.some((violation) => covers(entry, violation))) continue;
    findings.push(fail(`\`${entry.path}\` defers \`${entry.ruleId}\`, which it no longer violates — delete the entry, the list only shrinks`));
  }

  return checkResult(findings, `${files.length} files scanned against ${Object.keys(MODERN_CSS_RULES).length} rules, ${deferred} deferred.`);
}
