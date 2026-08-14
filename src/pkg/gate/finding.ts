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

/** Renders one finding as a level tag, its location, and its message with evidence indented. */
export function formatFinding(finding: Finding): string {
  const tag = finding.level === "fail" ? "FAIL" : "warn";
  const at = finding.file === undefined ? "" : ` ${finding.file}${finding.line === undefined ? "" : `:${finding.line}`}`;
  const head = `${tag}${at}: ${finding.message}`;
  const detail = (finding.detail ?? []).map((line) => `    ${line}`);
  return [head, ...detail].join("\n");
}

/** Renders a whole result: every finding, then the summary when the check passed. */
export function formatCheckResult(result: CheckResult): string {
  const lines = result.findings.map(formatFinding);
  if (result.ok) lines.push(`  ok ${result.summary}`);
  return lines.join("\n");
}

/** Prints a result and returns the exit code a standalone binding should exit with. @public */
export function reportCheck(result: CheckResult): number {
  const rendered = formatCheckResult(result);
  if (rendered !== "") console[result.ok ? "log" : "error"](rendered);
  return result.ok ? 0 : 1;
}
