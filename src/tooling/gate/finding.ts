import { PLAIN } from "../term/color";
import type { Colorize } from "../term/types";
import type { CheckResult, Finding } from "./types";

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

/** The refusal a check returns when its scan set is empty. @public */
export function scannedNothing(what: string, gate: string, verb = "scanned"): CheckResult {
  return checkResult([fail(`${what} — refusing to report a green ${gate} gate that ${verb} nothing`)], "");
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
