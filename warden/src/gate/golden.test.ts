import { describe, expect, it } from "bun:test";

import { parseId } from "../corpus/ident";
import { GOLDEN } from "./golden";

describe("GOLDEN", () => {
  it("gives every entry a parseable chunk id, so a typo fails here rather than as a retrieval miss", () => {
    for (const golden of GOLDEN) {
      expect(parseId(golden.expect)?.section).toBeDefined();
    }
  });

  it("asks no question twice", () => {
    expect(new Set(GOLDEN.map((golden) => golden.query)).size).toBe(GOLDEN.length);
  });

  it("uses thresholds, never an exact rank — a prose edit that swaps ranks 1 and 2 must not fail a build", () => {
    for (const golden of GOLDEN) expect(golden.within ?? 3).toBeGreaterThan(1);
  });

  it("covers every canon document, which is what stops the set decaying into a stale fixture", () => {
    const canon = new Set(GOLDEN.filter((golden) => golden.expect.startsWith("canon")).map((golden) => golden.expect.split("#")[0]));

    expect(canon.size).toBeGreaterThanOrEqual(9);
  });
});
