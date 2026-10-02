import { describe, expect, test } from "bun:test";

import { decodeEntity } from "./entities";

describe("decodeEntity", () => {
  test("decodes the names CommonMark's example 25 uses", () => {
    const names = ["nbsp", "amp", "copy", "AElig", "Dcaron", "frac34", "HilbertSpace", "DifferentialD", "ClockwiseContourIntegral", "ngE"];
    expect(names.map(decodeEntity)).toEqual(["\u00a0", "&", "©", "Æ", "Ď", "¾", "ℋ", "ⅆ", "∲", "≧̸"]);
  });

  test("decodes a name outside the Basic Multilingual Plane", () => {
    expect(decodeEntity("Afr")).toBe("\u{1d504}");
  });

  test("returns undefined for a name HTML does not define", () => {
    expect(["Copy", "x", "hasOwnProperty", "__proto__", "constructor", ""].map(decodeEntity)).toEqual(Array(6).fill(undefined));
  });
});
