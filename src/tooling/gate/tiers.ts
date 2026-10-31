import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import type { GateTier, ResolvedTier, ResolvedTiers, Step, StepsConfig, StepTiers, TierEntry, TierRef } from "./types";
import { GATE_TIERS } from "./types";

/** Names a lower tier whose resolved rows a tier includes in place. @public */
export function tier<T extends GateTier>(name: T): TierRef<T> {
  return { tier: name };
}

/** Types the default export of a `config/steps.config.ts`. @public */
export function defineSteps(config: StepsConfig): StepsConfig {
  return config;
}

function isTierRef(entry: Step | TierRef): entry is TierRef {
  return !("label" in entry);
}

function entriesOf<K extends GateTier>(tiers: StepTiers, key: K): readonly (Step | TierRef)[] | undefined {
  return tiers[key];
}

/** Every step a table declares directly, its tiers walked in ascending order and each tier's order kept. @public */
export function declaredSteps(tiers: StepTiers): readonly Step[] {
  return GATE_TIERS.flatMap((key) => (entriesOf(tiers, key) ?? []).filter((entry): entry is Step => !isTierRef(entry)));
}

/** Whether a loaded module default is a `defineSteps` table. @public */
export function isStepsConfig(value: unknown): value is StepsConfig {
  if (typeof value !== "object" || value === null) return false;
  const tiers = (value as { tiers?: unknown }).tiers;
  return typeof tiers === "object" && tiers !== null && !Array.isArray(tiers);
}

/** Concatenates two tables tier by tier, `a`'s rows first, declaring each tier either declares. @public */
export function mergeTiers(a: StepTiers, b: StepTiers): StepTiers {
  const mergeKey = <K extends GateTier>(key: K): [K, readonly TierEntry<K>[]][] => {
    const left: readonly TierEntry<K>[] | undefined = a[key];
    const right: readonly TierEntry<K>[] | undefined = b[key];
    if (left === undefined && right === undefined) return [];
    return [[key, [...(left ?? []), ...(right ?? [])]]];
  };
  return Object.fromEntries(GATE_TIERS.flatMap((key) => mergeKey(key))) as StepTiers;
}

function duplicateLabels(steps: readonly Step[]): readonly string[] {
  const labels = steps.map((step) => step.label);
  return [...new Set(labels.filter((label, index) => labels.indexOf(label) !== index))];
}

/** Expands every `tier()` reference in place, refusing a reference to an undeclared or non-lower tier and a label a tier holds twice. @public */
export function resolveTiers(tiers: StepTiers): Result<ResolvedTiers, string> {
  const resolved: Partial<Record<GateTier, ResolvedTier>> = {};

  for (const key of GATE_TIERS) {
    const entries = entriesOf(tiers, key);
    if (entries === undefined) continue;

    const steps: Step[] = [];
    const home: Record<string, GateTier> = {};
    for (const entry of entries) {
      if (!isTierRef(entry)) {
        steps.push(entry);
        home[entry.label] = key;
        continue;
      }
      const ref = entry.tier;
      if (entriesOf(tiers, ref) === undefined) {
        return err(`The ${key} tier includes tier("${ref}"), which the table does not declare — add a \`${ref}\` key, or drop the reference.`);
      }
      const included = resolved[ref];
      if (GATE_TIERS.indexOf(ref) >= GATE_TIERS.indexOf(key) || included === undefined) {
        return err(`The ${key} tier includes tier("${ref}"), which is not below it — a tier may include only a lower one.`);
      }
      steps.push(...included.steps);
      Object.assign(home, included.home);
    }

    const duplicated = duplicateLabels(steps);
    if (duplicated.length > 0) {
      return err(
        `Duplicate step label in the ${key} tier: ${duplicated.join(", ")}. A label is the \`--only\` token and the name reported on failure, so it must name exactly one step.`,
      );
    }
    resolved[key] = { steps, home };
  }

  return ok(resolved);
}
