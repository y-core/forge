import { describe, expect, it } from "bun:test";

import { nestedHeadingLevel } from "./heading";

describe("nestedHeadingLevel()", () => {
  it("puts a nested heading one level below the view's own", () => {
    expect([1, 2, 3, 4, 5].map((level) => nestedHeadingLevel(level as 1))).toEqual([2, 3, 4, 5, 6]);
  });

  it("holds a heading nested under an h6 at 6", () => {
    expect(nestedHeadingLevel(6)).toBe(6);
  });
});
