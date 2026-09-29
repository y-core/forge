import { matchesGlob } from "node:path";

import { splitList } from "../cli/parse";
import type { CheckStep, GateMode, Selection, Step } from "./types";

/** The tiers in ascending order, so the CLI, the docs and the selector share one order. @public */
export const GATE_MODES = ["quality", "standard", "full"] as const;

/** Paths every step reads, so a change to one selects the whole table under `--affected`. @public */
export const DEFAULT_GATE_INPUTS: readonly string[] = ["package.json", "bun.lock", "bunfig.toml", "tsconfig*.json", "config/**", "../**"];

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

  for (const step of steps) {
    if (step.watches === undefined) continue;
    if (step.watches.length === 0) return `Step "${step.label}" declares an empty \`watches\` — omit it to run the step on every change.`;
    const negated = step.watches.find((entry) => entry.startsWith("!"));
    if (negated !== undefined) {
      return `Step "${step.label}" declares \`watches\` entry "${negated}" — a declaration only widens, so \`!\` exclusions are refused.`;
    }
  }

  return undefined;
}

function touches(step: Step, changed: readonly string[]): boolean {
  if (changed.length === 0) return false;
  return step.watches === undefined || step.watches.some((glob) => changed.some((path) => matchesGlob(path, glob)));
}

/** Resolves which steps to run in `mode`, cheaper tier first and declared order within a tier, narrowed by an `--only` list and by the paths `changed` touches. @public */
export function selectSteps(
  steps: readonly Step[],
  opts: { mode: GateMode; only?: readonly string[]; changed?: readonly string[]; gateInputs?: readonly string[] },
): Selection {
  const malformed = invalidTable(steps);
  if (malformed !== undefined) return { ok: false, error: malformed };

  // A rank comparison, so each mode is a superset of the one below it by construction. The sort is
  // stable, so every intra-tier ordering the table states — `lint` before `format` — survives it.
  const inMode = steps
    .filter((step) => rank(step.tier ?? "quality") <= rank(opts.mode))
    .sort((a, b) => rank(a.tier ?? "quality") - rank(b.tier ?? "quality"));
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

  const changed = opts.changed;
  if (changed !== undefined) {
    const inputs = [...DEFAULT_GATE_INPUTS, ...(opts.gateInputs ?? [])];
    const wide = changed.some((path) => inputs.some((glob) => matchesGlob(path, glob)));
    if (!wide) selected = selected.filter((step) => touches(step, changed));
  }

  if (selected.length === 0 && changed === undefined) {
    // Echoed as the caller wrote it, not as the splitter read it: a list that names nothing is
    // exactly the case where the reader needs to see their own text back.
    const scope = only === undefined ? "" : ` from --only "${only.join(" ")}"`;
    return { ok: false, error: `No steps selected for ${describe(opts.mode)}${scope} — refusing to report a green gate that ran nothing.` };
  }

  return { ok: true, steps: selected, total: inMode.length, scoped: changed !== undefined || selected.length < inMode.length };
}
