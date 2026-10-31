import { describe, expect, it } from "bun:test";

import { checkResult } from "../../../src/tooling/gate/finding";
import { tier } from "../../../src/tooling/gate/tiers";
import type { Step } from "../../../src/tooling/gate/types";
import type { GoldenQuery } from "./golden";
import { defineWardenQueries, goldenSetsOf, GOLDEN_STEP_LABEL, type GoldenStep, stepsOf } from "./step-sets";

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
  it("reads every step a table declares directly, skipping tier references", () => {
    const a = check("lint");
    const b = check("test");

    expect(stepsOf({ tiers: { static: [a], unit: [tier("static"), b] } })).toEqual([a, b]);
  });

  it("returns undefined for a value that is no defineSteps table", () => {
    const tiers = { static: [check("lint")] };

    expect([stepsOf([check("lint")]), stepsOf({ STEPS: [check("lint")] }), stepsOf({ default: { tiers } }), stepsOf(null)]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("defineWardenQueries()", () => {
  it("returns its argument unchanged", () => {
    const queries = { golden: QUERIES, negative: ["how do I file my taxes"] };

    expect(defineWardenQueries(queries)).toBe(queries);
  });
});
