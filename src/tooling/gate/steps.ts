import { matchesGlob } from "node:path";

import { splitList } from "../cli/parse";
import type { CheckStep, GateTier, ResolvedTiers, Selection, Step, StepReach } from "./types";
import { GATE_TIERS } from "./types";

/** Paths every step reads, so a change to one selects the whole table under `--affected`. @public */
export const DEFAULT_GATE_INPUTS: readonly string[] = ["package.json", "bun.lock", "bunfig.toml", "tsconfig*.json", "config/**", "../**"];

/** Narrows a step to the in-process variant. @public */
export function isCheckStep(step: Step): step is CheckStep {
  return step.run !== undefined;
}

function rank(tier: GateTier): number {
  return GATE_TIERS.indexOf(tier);
}

/** Whether an absent prerequisite fails a run at `tier` rather than skipping its step: from `runtime` up, a runtime is promised. @internal */
export function failsWhenAbsent(tier: GateTier): boolean {
  return rank(tier) >= rank("runtime");
}

function describe(tier: GateTier): string {
  return `a ${tier} run`;
}

function matchesAnyFile(glob: string, files: readonly string[]): boolean {
  return files.some((path) => matchesGlob(path, glob));
}

// A root-level name may be an optional tool config the row must notice being created, and a path above the root is
// outside the listing. A rename removes a glob's literal directory, so a source tree holding no matching file yet is live.
function isDeadGlob(glob: string, files: readonly string[]): boolean {
  if (!glob.includes("/") || glob.startsWith("../") || matchesAnyFile(glob, files)) return false;
  const segments = glob.split("/");
  const wild = segments.findIndex((segment) => /[*?[{]/.test(segment));
  const base = (wild === -1 ? segments : segments.slice(0, wild)).join("/");
  return base !== "" && !files.some((path) => path === base || path.startsWith(`${base}/`));
}

function deadGlob(steps: readonly Step[], files: readonly string[]): string | undefined {
  for (const step of steps) {
    for (const [field, globs] of [
      ["watches", step.watches ?? []],
      ["narrow.wide", step.narrow?.wide ?? []],
    ] as const) {
      const dead = globs.find((glob) => isDeadGlob(glob, files));
      if (dead !== undefined) {
        return `Step "${step.label}" declares \`${field}\` glob "${dead}", which matches no file in the work tree — a renamed path no longer reaches the step, so update the glob.`;
      }
    }
  }
  return undefined;
}

// The rule is a property of the table itself, so it is checked before the tier is applied — a
// malformed table is refused whichever run was asked for, rather than only the run that trips it.
function invalidTable(steps: readonly Step[], files: readonly string[] | undefined): string | undefined {
  for (const step of steps) {
    if (step.watches === undefined) continue;
    if (step.watches.length === 0) return `Step "${step.label}" declares an empty \`watches\` — omit it to run the step on every change.`;
    const negated = step.watches.find((entry) => entry.startsWith("!"));
    if (negated !== undefined) {
      return `Step "${step.label}" declares \`watches\` entry "${negated}" — a declaration only widens, so \`!\` exclusions are refused.`;
    }
  }

  return files === undefined ? undefined : deadGlob(steps, files);
}

function touches(step: Step, changed: readonly string[]): boolean {
  if (changed.length === 0) return false;
  return step.watches === undefined || step.watches.some((glob) => changed.some((path) => matchesGlob(path, glob)));
}

function matchesAny(changed: readonly string[], globs: readonly string[]): boolean {
  return changed.some((path) => globs.some((glob) => matchesGlob(path, glob)));
}

function reachOf(step: Step, tier: GateTier, pending: readonly string[] | undefined, gateWide: boolean, home: GateTier | undefined): StepReach {
  if (tier !== "runtime" || pending === undefined) return "whole";
  const followsChanges = step.narrow !== undefined || home === "runtime";
  if (!followsChanges) return "whole";
  if (gateWide || matchesAny(pending, step.narrow?.wide ?? [])) return "whole";
  if (!touches(step, pending)) return "untouched";
  return step.narrow === undefined ? "whole" : "narrow";
}

/** Resolves which rows of a resolved table to run at `tier` and how each runs: the tier's own order, filtered by `--only` and by the paths `changed` touches, at `runtime` narrowed to the `pending` changes for a row that narrows or whose home tier is `runtime`, and refused when a nested glob matches none of `files`. @public */
export function selectSteps(
  table: ResolvedTiers,
  opts: {
    tier: GateTier;
    only?: readonly string[];
    changed?: readonly string[];
    pending?: readonly string[];
    gateInputs?: readonly string[];
    files?: readonly string[];
  },
): Selection {
  const every = [...new Set(GATE_TIERS.flatMap((key) => table[key]?.steps ?? []))];
  const malformed = invalidTable(every, opts.files);
  if (malformed !== undefined) return { ok: false, error: malformed };

  const run = table[opts.tier];
  if (run === undefined) {
    return { ok: false, error: `The step table declares no ${opts.tier} tier — add a \`${opts.tier}\` key under \`tiers\`.` };
  }
  const inTier = run.steps;
  const known = inTier.map((step) => step.label);

  const only = opts.only !== undefined && opts.only.length === 0 ? undefined : opts.only;

  let selected = inTier;
  if (only !== undefined) {
    const wanted = splitList(only);

    for (const label of wanted) {
      if (!known.includes(label)) {
        return { ok: false, error: `Unknown --only label: "${label}". Known labels for ${describe(opts.tier)}: ${known.join(", ")}` };
      }
    }
    selected = inTier.filter((step) => wanted.includes(step.label));
  }

  const inputs = [...DEFAULT_GATE_INPUTS, ...(opts.gateInputs ?? [])];
  const changed = opts.changed;
  if (changed !== undefined && !matchesAny(changed, inputs)) selected = selected.filter((step) => touches(step, changed));

  if (selected.length === 0 && changed === undefined) {
    // Echoed as the caller wrote it, not as the splitter read it: a list that names nothing is
    // exactly the case where the reader needs to see their own text back.
    const scope = only === undefined ? "" : ` from --only "${only.join(" ")}"`;
    return { ok: false, error: `No steps selected for ${describe(opts.tier)}${scope} — refusing to report a green gate that ran nothing.` };
  }

  const pending = opts.pending;
  const gateWide = pending !== undefined && matchesAny(pending, inputs);
  const reach = Object.fromEntries(selected.map((step) => [step.label, reachOf(step, opts.tier, pending, gateWide, run.home[step.label])]));

  return { ok: true, steps: selected, reach, total: inTier.length, scoped: changed !== undefined || selected.length < inTier.length };
}
