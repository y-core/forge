import type { CheckResult } from "./finding";

/** How much of the table to run: `fast` needs nothing beyond `bun install`, `full` adds the steps
 *  that may require a machine prerequisite. @public */
export type GateMode = "fast" | "full";

/** A machine prerequisite a step needs, with the probe that detects it and the hint that installs it. @public */
export interface StepRequirement {
  /** What is missing, named verbatim in the failure line. */
  tool: string;
  /** Answers whether the prerequisite is satisfied. Defaults to whether `<tool> --version` exits 0. */
  probe?: () => boolean;
  /** Install hint shown verbatim when the probe fails. */
  hint: string;
}

/** What every step carries, whichever way it runs. @public */
export interface StepBase {
  /** Stable identifier — the `--only` token, and the name reported on failure. */
  label: string;
  /** Restricts this step to `--full` runs; omitted, it runs in every mode. */
  fullOnly?: boolean;
  /** Machine prerequisite checked before the step runs. Legal only on a `fullOnly` step. */
  requires?: StepRequirement;
}

/** A step run as an external process, reported from the tail of its captured output. @public */
export interface CommandStep extends StepBase {
  /** Executable followed by its arguments. Resolved against the runner's `binDir` on `PATH`. */
  cmd: readonly [string, ...string[]];
  /** Lines of the step's captured output shown when it fails. */
  tail: number;
  /** Auto-fixing counterpart invoked by `--fix`. Steps without one are reported as skipped. */
  fix?: readonly [string, ...string[]];
  run?: never;
}

/** A step run in-process, reported from the findings it returns rather than from captured text. @public */
export interface CheckStep extends StepBase {
  /** Invoked by the runner; its findings are printed verbatim, so there is no `tail` to truncate to. */
  run: () => CheckResult | Promise<CheckResult>;
  cmd?: never;
}

/** One gate step: an external command, or a check the runner calls directly. @public */
export type Step = CommandStep | CheckStep;

/** Narrows a step to the in-process variant. @public */
export function isCheckStep(step: Step): step is CheckStep {
  return step.run !== undefined;
}

/** A resolved run plan, or the reason no run may proceed. @public */
export type Selection =
  | {
      ok: true;
      /** The steps to run, in table order. */
      steps: readonly Step[];
      /** How many steps the mode holds in total — the denominator of the scoped banner. */
      total: number;
      /** True when fewer steps were selected than the mode holds, i.e. a green is not a gate green. */
      scoped: boolean;
    }
  | { ok: false; error: string };

function describe(mode: GateMode): string {
  return mode === "full" ? "a full run" : "a fast run";
}

// Both rules are properties of the table itself, so they are checked before the mode is applied —
// a malformed table is refused whichever run was asked for, rather than only the run that trips it.
function invalidTable(steps: readonly Step[]): string | undefined {
  const labels = steps.map((step) => step.label);
  const duplicated = [...new Set(labels.filter((label, index) => labels.indexOf(label) !== index))];
  if (duplicated.length > 0) {
    return `Duplicate step label: ${duplicated.join(", ")}. A label is the \`--only\` token and the name reported on failure, so it must name exactly one step.`;
  }

  const premature = steps.filter((step) => step.requires !== undefined && step.fullOnly !== true).map((step) => step.label);
  if (premature.length > 0) {
    return `Machine prerequisite on a step that is not \`fullOnly\`: ${premature.join(", ")}. A fast run must work on any machine with the repository's dependencies installed.`;
  }

  return undefined;
}

/** Resolves which steps to run in `mode`, optionally narrowed by a comma-joined `--only` list. @public */
export function selectSteps(steps: readonly Step[], opts: { mode: GateMode; only?: string }): Selection {
  const malformed = invalidTable(steps);
  if (malformed !== undefined) return { ok: false, error: malformed };

  const inMode = opts.mode === "full" ? steps : steps.filter((step) => step.fullOnly !== true);
  const known = inMode.map((step) => step.label);

  let selected = inMode;
  if (opts.only !== undefined) {
    const wanted = opts.only
      .split(",")
      .map((label) => label.trim())
      .filter((label) => label.length > 0);

    for (const label of wanted) {
      if (!known.includes(label)) {
        return { ok: false, error: `Unknown --only label: "${label}". Known labels for ${describe(opts.mode)}: ${known.join(", ")}` };
      }
    }
    selected = inMode.filter((step) => wanted.includes(step.label));
  }

  if (selected.length === 0) {
    const scope = opts.only === undefined ? "" : ` from --only "${opts.only}"`;
    return { ok: false, error: `No steps selected for ${describe(opts.mode)}${scope} — refusing to report a green gate that ran nothing.` };
  }

  return { ok: true, steps: selected, total: inMode.length, scoped: selected.length < inMode.length };
}
