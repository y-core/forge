/** steps.ts — the verification gate's step vocabulary and the pure selection logic over it.
 *
 *  Nothing here spawns a process, reads a file, or reads the clock, so a project can unit-test
 *  its own step table at zero step cost — which is what makes `selectSteps` published surface
 *  rather than a runner internal. The table itself belongs to the project: forge's lives in
 *  `scripts/lib/steps.ts`, and `cloudflareWorkerSteps` builds the one this fleet's apps share.
 */

/** A named gate. `check` is the post-development gate and carries no machine prerequisite;
 *  `verify` is the pre-release gate and may.
 *
 *  Deliberately closed. The two names *are* the invariant — a third verb would have no defined
 *  answer to "may this require a browser?", and that question is the whole point of the split.
 *  See `.decisions/TESTING.md` §6.
 *
 * @public
 */
export type Gate = "check" | "verify";

/** A prerequisite that must be satisfied before a step can run, with the command that installs
 *  it and the command that answers whether it is already there.
 *
 * @public
 */
export interface StepRequirement {
  /** What is missing, named verbatim in the failure line. */
  tool: string;
  /** Command whose exit code answers whether the prerequisite is satisfied. Defaults to
   *  `<tool> --version`, which only holds when the prerequisite *is* an executable on `PATH`. */
  probe?: readonly [string, ...string[]];
  /** Install hint shown verbatim when the probe fails. */
  hint: string;
}

/** One gate step: what to run, which gates it belongs to, and how to report it.
 *
 * @public
 */
export interface Step {
  /** Stable identifier — the `--only` token, and the name reported on failure. */
  label: string;
  /** Gates this step belongs to. A step in no gate is unreachable. */
  gates: readonly Gate[];
  /** Lines of captured output to show when the step fails. */
  tail: number;
  /** Executable followed by its arguments. Resolved against the runner's `binDir` on `PATH`. */
  cmd: readonly [string, ...string[]];
  /** Auto-fixing counterpart invoked by `--fix`. Steps without one are reported as skipped. */
  fix?: readonly [string, ...string[]];
  /** Machine prerequisite checked before the step runs. */
  requires?: StepRequirement;
}

/** A resolved run plan, or the reason no run may proceed.
 *
 * @public
 */
export type Selection =
  | {
      ok: true;
      /** The steps to run, in table order. */
      steps: readonly Step[];
      /** How many steps the gate holds in total — the denominator of the scoped banner. */
      total: number;
      /** True when fewer steps were selected than the gate holds, i.e. a green is not a gate green. */
      scoped: boolean;
    }
  | { ok: false; error: string };

/** Resolve which steps to run for `gate`, optionally narrowed by a comma-joined `--only` list.
 *
 *  Pure: no disk, no spawning, no clock. Three refusals, all returned rather than thrown:
 *  an unknown `--only` label, a label outside the requested gate, and — checked on the *outcome*,
 *  not the input — a selection of zero steps. The last is the guard that still holds when the
 *  selection logic itself is wrong: without it a gate that ran nothing reports the same green as
 *  a gate that ran everything.
 *
 * @public
 */
export function selectSteps(steps: readonly Step[], opts: { gate: Gate; only?: string }): Selection {
  const inGate = steps.filter((step) => step.gates.includes(opts.gate));
  const known = inGate.map((step) => step.label);

  let selected = inGate;
  if (opts.only !== undefined) {
    const wanted = opts.only
      .split(",")
      .map((label) => label.trim())
      .filter((label) => label.length > 0);

    for (const label of wanted) {
      if (!known.includes(label)) {
        return { ok: false, error: `Unknown --only label: "${label}". Known labels for ${opts.gate}: ${known.join(", ")}` };
      }
    }
    selected = inGate.filter((step) => wanted.includes(step.label));
  }

  if (selected.length === 0) {
    const scope = opts.only === undefined ? "" : ` from --only "${opts.only}"`;
    return { ok: false, error: `No steps selected for ${opts.gate}${scope} — refusing to report a green gate that ran nothing.` };
  }

  return { ok: true, steps: selected, total: inGate.length, scoped: selected.length < inGate.length };
}
