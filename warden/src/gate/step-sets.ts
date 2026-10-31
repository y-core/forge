/** The golden sets a repository's step table already declares, read back off the table. */

import { declaredSteps, isStepsConfig } from "../../../src/tooling/gate/tiers";
import type { CheckStep, Step } from "../../../src/tooling/gate/types";
import type { GoldenQuery } from "./golden";

/** The label the golden row carries — the `--only` token, and the key this module finds it by. @public */
export const GOLDEN_STEP_LABEL = "warden:queries";

/** The golden row, carrying the sets it measures rather than only the closure that measures them. @public */
export interface GoldenStep extends CheckStep {
  /** The effective golden set — the caller's, or the shipped one where it stated none. */
  golden: readonly GoldenQuery[];
  /** The effective negative set, on the same terms. */
  negative: readonly string[];
}

function isGoldenStep(step: Step): step is GoldenStep {
  const candidate = step as Partial<GoldenStep>;
  return step.label === GOLDEN_STEP_LABEL && Array.isArray(candidate.golden) && Array.isArray(candidate.negative);
}

/** The sets the table's golden row carries, or `undefined` where it holds no such row. @public */
export function goldenSetsOf(steps: readonly Step[]): { golden: readonly GoldenQuery[]; negative: readonly string[] } | undefined {
  const step = steps.find(isGoldenStep);
  return step === undefined ? undefined : { golden: step.golden, negative: step.negative };
}

/** Every step a loaded `defineSteps` table declares directly; `undefined` where the value is no such table. @public */
export function stepsOf(config: unknown): readonly Step[] | undefined {
  return isStepsConfig(config) ? declaredSteps(config.tiers) : undefined;
}

/** What a `--golden` module default-exports through `defineWardenQueries`. @public */
export interface WardenQueries {
  golden: readonly GoldenQuery[];
  /** Questions the corpus must refuse; omitted, none. */
  negative?: readonly string[];
}

/** Types the default export of a `--golden` module. @public */
export function defineWardenQueries(queries: WardenQueries): WardenQueries {
  return queries;
}
