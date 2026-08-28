import type { Colorize } from "../../term/color";
import { PLAIN } from "../../term/color";

/** The severity of a finding: `fail` fails the check, `warn` is reported and does not. */
export type FindingLevel = "fail" | "warn";

/** One thing a check has to say about the tree it walked. @public */
export interface Finding {
  level: FindingLevel;
  message: string;
  /** Repository-relative path, when the finding is about one file. */
  file?: string;
  /** 1-indexed line within `file`. */
  line?: number;
  /** Evidence lines shown indented beneath `message`. */
  detail?: readonly string[];
}

/** What a check returns: its verdict, its findings, and one line naming what it covered. @public */
export interface CheckResult {
  ok: boolean;
  findings: readonly Finding[];
  summary: string;
}

/** Builds a `CheckResult`, deriving `ok` from the findings. @public */
export function checkResult(findings: readonly Finding[], summary: string): CheckResult {
  return { ok: !findings.some((finding) => finding.level === "fail"), findings, summary };
}

/** A `fail` finding. */
export function fail(message: string, extra: Omit<Finding, "level" | "message"> = {}): Finding {
  return { level: "fail", message, ...extra };
}

/** A `warn` finding. */
export function warn(message: string, extra: Omit<Finding, "level" | "message"> = {}): Finding {
  return { level: "warn", message, ...extra };
}

/**
 * Renders one finding as a level tag, its location, and its message with evidence indented.
 *
 * `style` defaults to `PLAIN`, which is what keeps every exact-match assertion on this output
 * true without an edit: colour is something a caller asks for, never something the formatter
 * decides on its own.
 */
export function formatFinding(finding: Finding, style: Colorize = PLAIN): string {
  const tag = finding.level === "fail" ? style.red("FAIL") : style.yellow("warn");
  const at = finding.file === undefined ? "" : ` ${finding.file}${finding.line === undefined ? "" : `:${finding.line}`}`;
  const head = `${tag}${at}: ${finding.message}`;
  const detail = (finding.detail ?? []).map((line) => `    ${line}`);
  return [head, ...detail].join("\n");
}

/** Renders a whole result: every finding, then the summary when the check passed. */
export function formatCheckResult(result: CheckResult, style: Colorize = PLAIN): string {
  const lines = result.findings.map((finding) => formatFinding(finding, style));
  if (result.ok) lines.push(`  ${style.green("ok")} ${result.summary}`);
  return lines.join("\n");
}

/** Prints a result and returns the exit code a standalone binding should exit with. @public */
export function reportCheck(result: CheckResult): number {
  const rendered = formatCheckResult(result);
  if (rendered !== "") console[result.ok ? "log" : "error"](rendered);
  return result.ok ? 0 : 1;
}
