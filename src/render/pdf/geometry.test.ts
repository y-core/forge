import { describe, expect, test } from "bun:test";

import { KAPPA, LABEL_GAP, LABEL_WIDTH, MARGIN, MIN_VALUE_WIDTH, PAGE_WIDTH } from "./geometry";

describe("a field's label column", () => {
  test("leaves room for a value column wide enough to stay one", () => {
    const measure = PAGE_WIDTH - MARGIN * 2;
    expect(measure - LABEL_WIDTH - LABEL_GAP).toBeGreaterThanOrEqual(MIN_VALUE_WIDTH);
  });
});

describe("the circle constant", () => {
  test("puts a quarter arc's midpoint on the circle it approximates", () => {
    // Bézier from (1,0) to (0,1) with handles KAPPA long; at t=0.5 a true circle is one unit out.
    const at = (a: number, b: number, c: number, d: number): number => (a + 3 * b + 3 * c + d) / 8;
    const x = at(1, 1, KAPPA, 0);
    const y = at(0, KAPPA, 1, 1);
    expect(Math.hypot(x, y)).toBeCloseTo(1, 4);
  });
});
