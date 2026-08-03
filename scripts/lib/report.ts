/** report.ts — pure formatters for the gate runner's output.
 *
 *  Strings in, strings out: every line the runner prints is produced here, so the reporting
 *  contract is assertable without spawning a single step.
 */

/** Format a duration for a step line. Sub-50ms renders as `<0.1s` rather than `0.0s`, which
 *  reads as a broken timer rather than an instant step. */
export function formatDuration(ms: number): string {
  return ms < 50 ? "<0.1s" : `${(ms / 1000).toFixed(1)}s`;
}

/** One per-step result line: `✓ lint (0.7s)` or `✗ lint (0.7s)`. */
export function formatStepLine(label: string, ok: boolean, ms: number): string {
  return `${ok ? "✓" : "✗"} ${label} (${formatDuration(ms)})`;
}

/** The failing step's last `tail` lines, indented so they read as evidence rather than as
 *  further runner output. Trailing blank lines are dropped first, so `tail` counts content. */
export function formatFailureExcerpt(output: string, tail: number): string {
  const lines = output.split("\n");
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  if (lines.length === 0) return "    (no output)";
  return lines
    .slice(-tail)
    .map((line) => `    ${line}`)
    .join("\n");
}

/** The scoped-run warning. Appended to summary lines rather than printed beside them: a
 *  summary line read on its own must never pass for a gate green. */
export function formatScopedBanner(selected: number, total: number): string {
  return `⚠ scoped run (${selected} of ${total} steps) — not the gate`;
}

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

/** The single closing line. On failure it names the step, which is what makes a gate verdict
 *  machine-readable instead of inferred from raw tool output. */
export function formatSummary(input: SummaryInput): string {
  const scoped = input.selected < input.total ? ` ${formatScopedBanner(input.selected, input.total)}` : "";
  if (input.failedAt !== undefined) {
    const progress = `${input.ran} of ${input.selected} steps run`;
    return `✗ ${input.gate} — failed at \`${input.failedAt}\` (${progress}, ${formatDuration(input.ms)})${scoped}`;
  }
  const plural = input.selected === 1 ? "step" : "steps";
  return `✓ ${input.gate} — ${input.selected} ${plural} passed (${formatDuration(input.ms)})${scoped}`;
}

/** The `--list` output: the resolved selection, one label per line, running nothing. */
export function formatList(gate: string, labels: readonly string[], total: number): string {
  const scoped = labels.length < total ? `\n${formatScopedBanner(labels.length, total)}` : "";
  const plural = labels.length === 1 ? "step" : "steps";
  return [`${gate} — ${labels.length} ${plural}`, ...labels.map((label) => `  ${label}`)].join("\n") + scoped;
}

/** The `--fix` closing line. A fixer pass proves nothing on its own, so it always ends by
 *  pointing at the run that does. */
export function formatFixSummary(gate: string, fixed: number, skipped: number): string {
  const detail = skipped === 0 ? "" : `, ${skipped} without a fixer`;
  return `${fixed} fixed${detail} — re-run \`bun run ${gate}\` to confirm.`;
}

/** The line shown when a step's machine prerequisite is absent. */
export function formatMissingRequirement(label: string, tool: string, hint: string): string {
  return `✗ ${label} — ${tool} not found; run \`${hint}\``;
}
