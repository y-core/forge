import { describe, expect, it } from "bun:test";

import { checkResult } from "../../../src/tooling/gate/finding";
import type { Step } from "../../../src/tooling/gate/types";
import type { GoldenQuery } from "./golden";
import { goldenSetsOf, GOLDEN_STEP_LABEL, type GoldenStep, stepsOf } from "./step-sets";

const QUERIES: readonly GoldenQuery[] = [{ query: "where do tests live", expect: "canon:TESTING.md#2a", dimension: "placement" }];

const check = (label: string): Step => ({ label, run: () => checkResult([], "nothing to check") });

const goldenStep = (golden: readonly GoldenQuery[], negative: readonly string[]): GoldenStep => ({
  ...(check(GOLDEN_STEP_LABEL) as GoldenStep),
  golden,
  negative,
});

describe("goldenSetsOf()", () => {
  it("returns the sets the golden row carries", () => {
    const sets = goldenSetsOf([check("lint"), goldenStep(QUERIES, ["how do I file my taxes"]), check("warden:duplicates")]);

    expect(sets).toEqual({ golden: QUERIES, negative: ["how do I file my taxes"] });
  });

  it("returns undefined where the table holds no golden row", () => {
    expect(goldenSetsOf([check("lint"), check("warden:index")])).toBeUndefined();
  });

  it("returns undefined where a row takes the label but carries no sets", () => {
    expect(goldenSetsOf([check(GOLDEN_STEP_LABEL)])).toBeUndefined();
  });
});

describe("stepsOf()", () => {
  it("reads the default export", () => {
    const steps = [check("lint")];

    expect(stepsOf({ default: steps })).toBe(steps);
  });

  it("falls back to a named STEPS export", () => {
    const steps = [check("lint")];

    expect(stepsOf({ STEPS: steps })).toBe(steps);
  });

  it("prefers the default export where a module carries both", () => {
    const fallback = [check("format")];

    expect(stepsOf({ default: [check("lint")], STEPS: fallback })).not.toBe(fallback);
  });

  it("returns undefined where the module exports neither", () => {
    expect(stepsOf({ GOLDEN: QUERIES })).toBeUndefined();
  });
});
