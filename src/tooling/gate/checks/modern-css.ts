import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MODERN_CSS_RULES, modernCssRule } from "../../lint/modern-css-rules";
import { checkResult, fail, scannedNothing, warn } from "../finding";
import type { CheckResult, Finding } from "../types";
import { MODERN_CSS_DEFERRED } from "./modern-css-deferred";
import { findModernCssViolations } from "./modern-css-parse";
import { findModernCssSourceViolations } from "./modern-css-source-parse";
import { resolveSources } from "./source-scan";
import type { DeferredFinding } from "./types";
import type { ModernCssFinding } from "./types";
import type { ModernCssCheckConfig } from "./types";

const SKIPPED = (name: string): boolean => /\.test\.tsx?$/.test(name) || /\.browser\.tsx?$/.test(name);

const SCANNED = (name: string): boolean => /\.(?:css|scss|sass|tsx?)$/.test(name) && !SKIPPED(name);

const PREPROCESSED = (name: string): boolean => /\.(?:scss|sass)$/.test(name);

function covers(entry: DeferredFinding, finding: ModernCssFinding): boolean {
  return entry.ruleId === finding.ruleId && (finding.file === entry.path || finding.file.startsWith(`${entry.path}/`));
}

/** Run every Tier A rule over the configured sources. @public */
export function checkModernCss(config: ModernCssCheckConfig): CheckResult {
  const { root, sources } = config;
  const deferrals = config.deferred ?? MODERN_CSS_DEFERRED;
  const owned = deferrals.filter((entry) => entry.owner.trim() !== "");
  const files = resolveSources(root, sources, SCANNED);

  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no stylesheet or source`, "modern-CSS");

  // One read per file, not two: both passes below want the same text.
  const sourced = files.map((file) => [file, readFileSync(resolve(root, file), "utf-8")] as const);
  // A preprocessor stylesheet is only ever reported for being one, so no textual rule reads it.
  const violations = sourced.filter(([file]) => !PREPROCESSED(file)).flatMap(([file, text]) => findModernCssViolations(text, file));
  const adoption = sourced.flatMap(([file, text]) => findModernCssSourceViolations(text, file));
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
