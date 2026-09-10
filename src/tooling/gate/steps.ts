import { splitList } from "../cli/parse";
import type { CheckStep, GateMode, Selection, Step } from "./types";

/** The three tiers in ascending order, so the CLI, the docs and the selector share one order. @public */
export const GATE_MODES = ["fast", "standard", "full"] as const;

/** Narrows a step to the in-process variant. @public */
export function isCheckStep(step: Step): step is CheckStep {
  return step.run !== undefined;
}

function rank(mode: GateMode): number {
  return GATE_MODES.indexOf(mode);
}

function describe(mode: GateMode): string {
  return `a ${mode} run`;
}

// The rule is a property of the table itself, so it is checked before the mode is applied — a
// malformed table is refused whichever run was asked for, rather than only the run that trips it.
function invalidTable(steps: readonly Step[]): string | undefined {
  const labels = steps.map((step) => step.label);
  const duplicated = [...new Set(labels.filter((label, index) => labels.indexOf(label) !== index))];
  if (duplicated.length > 0) {
    return `Duplicate step label: ${duplicated.join(", ")}. A label is the \`--only\` token and the name reported on failure, so it must name exactly one step.`;
  }

  return undefined;
}

/**
 * Resolves which steps to run in `mode`, optionally narrowed by an `--only` list.
 *
 * An **empty array is the flag's absence**, not a request for nothing: that is what a repeatable
 * flag resolves to when it was never given, and reading it as "select no steps" would refuse every
 * unscoped run.
 * @public
 */
export function selectSteps(steps: readonly Step[], opts: { mode: GateMode; only?: readonly string[] }): Selection {
  const malformed = invalidTable(steps);
  if (malformed !== undefined) return { ok: false, error: malformed };

  // A rank comparison, so each mode is a superset of the one below it by construction.
  const inMode = steps.filter((step) => rank(step.tier ?? "fast") <= rank(opts.mode));
  const known = inMode.map((step) => step.label);

  const only = opts.only !== undefined && opts.only.length === 0 ? undefined : opts.only;

  let selected = inMode;
  if (only !== undefined) {
    const wanted = splitList(only);

    for (const label of wanted) {
      if (!known.includes(label)) {
        return { ok: false, error: `Unknown --only label: "${label}". Known labels for ${describe(opts.mode)}: ${known.join(", ")}` };
      }
    }
    selected = inMode.filter((step) => wanted.includes(step.label));
  }

  if (selected.length === 0) {
    // Echoed as the caller wrote it, not as the splitter read it: a list that names nothing is
    // exactly the case where the reader needs to see their own text back.
    const scope = only === undefined ? "" : ` from --only "${only.join(" ")}"`;
    return { ok: false, error: `No steps selected for ${describe(opts.mode)}${scope} — refusing to report a green gate that ran nothing.` };
  }

  return { ok: true, steps: selected, total: inMode.length, scoped: selected.length < inMode.length };
}
