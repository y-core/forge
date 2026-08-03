/** steps.ts — the verification gate's step table and the pure selection logic over it.
 *
 *  This file is the single source of truth for what the gate runs; `package.json` holds only
 *  the two verbs that invoke it. Nothing here spawns a process, so the whole selection surface
 *  is unit-testable at zero step cost — see `steps.test.ts`.
 */

/** A named gate. `check` is the post-development gate and carries no machine prerequisite;
 *  `verify` is the pre-release gate and may. See `.decisions/TESTING.md` §6. */
export type Gate = "check" | "verify";

/** A tool that must be installed before a step can run, with the command that installs it. */
export interface StepRequirement {
  /** Executable probed with `hasTool` (i.e. `<tool> --version` must exit 0). */
  tool: string;
  /** Install hint shown verbatim when the probe fails. */
  hint: string;
}

/** One gate step: what to run, which gates it belongs to, and how to report it. */
export interface Step {
  /** Stable identifier — the `--only` token, and the name reported on failure. */
  label: string;
  /** Gates this step belongs to. A step in no gate is unreachable. */
  gates: readonly Gate[];
  /** Lines of captured output to show when the step fails. */
  tail: number;
  /** Executable followed by its arguments. Resolved against `node_modules/.bin` on `PATH`. */
  cmd: readonly [string, ...string[]];
  /** Auto-fixing counterpart invoked by `--fix`. Steps without one are reported as skipped. */
  fix?: readonly [string, ...string[]];
  /** Machine prerequisite checked before the step runs. */
  requires?: StepRequirement;
}

const CHECK_AND_VERIFY: readonly Gate[] = ["check", "verify"];

/** The gate's steps, in execution order.
 *
 *  `typecheck` runs first deliberately: a type failure cascades into misleading lint and test
 *  failures, so fail-fast ordering encodes `.decisions/TESTING.md` §6b's "fix types first" rule
 *  rather than leaving it to the reader.
 */
export const STEPS: readonly Step[] = [
  { label: "typecheck", gates: CHECK_AND_VERIFY, tail: 20, cmd: ["tsgo", "--noEmit"] },
  { label: "lint", gates: CHECK_AND_VERIFY, tail: 20, cmd: ["biome", "check", "src/"], fix: ["biome", "check", "--write", "src/"] },
  { label: "test", gates: CHECK_AND_VERIFY, tail: 40, cmd: ["bun", "test"] },
  { label: "validate-exports", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-exports.ts"] },
  { label: "validate-jsx", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-jsx.ts"] },
  { label: "validate-docs", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-docs.ts"] },
  { label: "validate-css-sources", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-css-sources.ts"] },
  {
    label: "test:browser",
    gates: ["verify"],
    tail: 40,
    cmd: ["playwright", "test"],
    requires: { tool: "playwright", hint: "bun run test:install" },
  },
];

/** A resolved run plan, or the reason no run may proceed. */
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
