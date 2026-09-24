/** The golden sets a repository's step table already declares, read back off the table. */

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

/** The step table a `config/steps.ts` exports, as `default` or `STEPS`; `undefined` where it exports neither. @public */
export function stepsOf(module: unknown): readonly Step[] | undefined {
  const exports = module as { default?: unknown; STEPS?: unknown };
  for (const candidate of [exports.default, exports.STEPS]) if (Array.isArray(candidate)) return candidate as readonly Step[];
  return undefined;
}
