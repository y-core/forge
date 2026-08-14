import { type Finding, formatFinding } from "./finding";

/** Formats a duration for a step line, rendering sub-50ms as `<0.1s`. */
export function formatDuration(ms: number): string {
  return ms < 50 ? "<0.1s" : `${(ms / 1000).toFixed(1)}s`;
}

/** Formats one per-step result line, as `✓ lint (0.7s)`. */
export function formatStepLine(label: string, ok: boolean, ms: number): string {
  return `${ok ? "✓" : "✗"} ${label} (${formatDuration(ms)})`;
}

/** Formats a failing step's last `tail` lines of content, indented, ignoring trailing blanks. */
export function formatFailureExcerpt(output: string, tail: number): string {
  const lines = output.split("\n");
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  if (lines.length === 0) return "    (no output)";
  return lines
    .slice(-tail)
    .map((line) => `    ${line}`)
    .join("\n");
}

/** Formats a check step's findings, indented to match a command step's failure excerpt. */
export function formatFindingBlock(findings: readonly Finding[]): string {
  return findings
    .flatMap((finding) => formatFinding(finding).split("\n"))
    .map((line) => `    ${line}`)
    .join("\n");
}

/** Formats the scoped-run warning appended to a summary line. */
export function formatScopedBanner(selected: number, total: number): string {
  return `⚠ scoped run (${selected} of ${total} steps) — not the gate`;
}

/** The counts and outcome a closing summary line is rendered from. */
export interface SummaryInput {
  /** Gate verb, used verbatim in the line so `check` and `verify` are distinguishable. */
  gate: string;
  /** Steps actually executed — fewer than `selected` when the run stopped at a failure. */
  ran: number;
  /** Steps the selection resolved to. */
  selected: number;
  /** Steps the gate holds in total. */
  total: number;
  /** Label of the failing step; absent when every step passed. */
  failedAt?: string;
  /** Wall-clock duration of the whole run. */
  ms: number;
}

/** Formats the single closing line, naming the failing step when there is one. */
export function formatSummary(input: SummaryInput): string {
  const scoped = input.selected < input.total ? ` ${formatScopedBanner(input.selected, input.total)}` : "";
  if (input.failedAt !== undefined) {
    const progress = `${input.ran} of ${input.selected} steps run`;
    return `✗ ${input.gate} — failed at \`${input.failedAt}\` (${progress}, ${formatDuration(input.ms)})${scoped}`;
  }
  const plural = input.selected === 1 ? "step" : "steps";
  return `✓ ${input.gate} — ${input.selected} ${plural} passed (${formatDuration(input.ms)})${scoped}`;
}

/** Formats the `--list` output: the resolved selection, one label per line. */
export function formatList(gate: string, labels: readonly string[], total: number): string {
  const scoped = labels.length < total ? `\n${formatScopedBanner(labels.length, total)}` : "";
  const plural = labels.length === 1 ? "step" : "steps";
  return [`${gate} — ${labels.length} ${plural}`, ...labels.map((label) => `  ${label}`)].join("\n") + scoped;
}

/** Formats the `--fix` closing line, which always points at the run that confirms it. */
export function formatFixSummary(gate: string, fixed: number, skipped: number): string {
  const detail = skipped === 0 ? "" : `, ${skipped} without a fixer`;
  return `${fixed} fixed${detail} — re-run \`bun run ${gate}\` to confirm.`;
}

/** Formats the line shown when a step's machine prerequisite is absent. */
export function formatMissingRequirement(label: string, tool: string, hint: string): string {
  return `✗ ${label} — ${tool} not found; run \`${hint}\``;
}

/** Formats the pointer to a failing step's untruncated output, indented to match the excerpt. */
export function formatFullLogPath(path: string): string {
  return `    full log at ${path}`;
}
