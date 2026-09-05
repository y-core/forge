import type { Colorize } from "../term/color";
import { PLAIN } from "../term/color";
import { type Finding, formatFinding } from "./finding";
import type { GateMode, Step } from "./steps";

/** Formats a duration for a step line, rendering sub-50ms as `<0.1s`. */
export function formatDuration(ms: number): string {
  return ms < 50 ? "<0.1s" : `${(ms / 1000).toFixed(1)}s`;
}

/** Formats one per-step result line, as `✓ lint (0.7s)`. `style` defaults to `PLAIN`. */
export function formatStepLine(label: string, ok: boolean, ms: number, style: Colorize = PLAIN): string {
  return `${ok ? style.green("✓") : style.red("✗")} ${label} (${formatDuration(ms)})`;
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
export function formatFindingBlock(findings: readonly Finding[], style: Colorize = PLAIN): string {
  return findings
    .flatMap((finding) => formatFinding(finding, style).split("\n"))
    .map((line) => `    ${line}`)
    .join("\n");
}

/** Formats the scoped-run warning appended to a summary line. */
export function formatScopedBanner(selected: number, total: number, style: Colorize = PLAIN): string {
  return `${style.yellow("⚠")} scoped run (${selected} of ${total} steps) — not the gate`;
}

/** The counts and outcome a closing summary line is rendered from. */
export interface SummaryInput {
  /** Gate verb, used verbatim in the line so `check` and `verify` are distinguishable. */
  gate: string;
  /** Steps that ran and passed — the only number a green line may be built from. */
  passed: number;
  /** Steps whose dependency was absent in a fast run. */
  skipped: number;
  /** Steps the selection resolved to. */
  selected: number;
  /** Steps the gate holds in total. */
  total: number;
  /** The failing step and its position in the selection; absent when nothing failed. */
  failedAt?: { label: string; at: number };
  /** Wall-clock duration of the whole run. */
  ms: number;
}

/** Formats the single closing line, naming the failing step when there is one. */
export function formatSummary(input: SummaryInput, style: Colorize = PLAIN): string {
  const scoped = input.selected < input.total ? ` ${formatScopedBanner(input.selected, input.total, style)}` : "";
  const skipped = input.skipped === 0 ? "" : `, ${input.skipped} skipped`;
  if (input.failedAt !== undefined) {
    const progress = `step ${input.failedAt.at} of ${input.selected}${skipped}`;
    return `${style.red("✗")} ${input.gate} — failed at \`${input.failedAt.label}\` (${progress}, ${formatDuration(input.ms)})${scoped}`;
  }
  if (input.passed === 0) {
    // The same refusal `selectSteps` makes at selection time, restated where the run can only learn it.
    return `${style.red("✗")} ${input.gate} — every step skipped (0 of ${input.selected} ran, ${formatDuration(input.ms)}) — refusing to report a green gate that ran nothing${scoped}`;
  }
  const plural = input.passed === 1 ? "step" : "steps";
  return `${style.green("✓")} ${input.gate} — ${input.passed} ${plural} passed${skipped} (${formatDuration(input.ms)})${scoped}`;
}

/** Formats the `--list` output: the resolved selection, one label per line. */
export function formatList(gate: string, labels: readonly string[], total: number, style: Colorize = PLAIN): string {
  const scoped = labels.length < total ? `\n${formatScopedBanner(labels.length, total, style)}` : "";
  const plural = labels.length === 1 ? "step" : "steps";
  return [`${gate} — ${labels.length} ${plural}`, ...labels.map((label) => `  ${label}`)].join("\n") + scoped;
}

/** The `--list` label of a step: its own, with the dependency it is conditional on in a fast run. */
export function listLabel(step: Step, mode: GateMode): string {
  if (step.requires === undefined) return step.label;
  return mode === "full" ? `${step.label} (requires ${step.requires.tool})` : `${step.label} (conditional — ${step.requires.tool} required)`;
}

/** Formats the `--fix` closing line, which always points at the run that confirms it. */
export function formatFixSummary(input: { gate: string; fixed: number; unfixable: number; skipped: number }): string {
  const detail = input.unfixable === 0 ? "" : `, ${input.unfixable} without a fixer`;
  const skipped = input.skipped === 0 ? "" : `, ${input.skipped} skipped`;
  return `${input.fixed} fixed${detail}${skipped} — re-run \`bun run ${input.gate}\` to confirm.`;
}

/** Formats the line shown when a step's dependency is absent: skipped in a fast run, failed under `--full`. */
export function formatMissingRequirement(label: string, tool: string, hint: string, mode: GateMode, style: Colorize = PLAIN): string {
  const detail = `${tool} not found; run \`${hint}\``;
  return mode === "full" ? `${style.red("✗")} ${label} — ${detail}` : `${style.yellow("○")} ${label} — skipped (${detail})`;
}

/** Formats the pointer to a failing step's untruncated output, indented to match the excerpt. */
export function formatFullLogPath(path: string): string {
  return `    full log at ${path}`;
}
