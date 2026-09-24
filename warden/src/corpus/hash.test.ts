import { describe, expect, it } from "bun:test";

import { fnv1a } from "./hash";

describe("fnv1a()", () => {
  it("is stable for the same text and different for a one-character change", () => {
    expect(fnv1a("the rule")).toBe(fnv1a("the rule"));
    expect(fnv1a("the rule")).not.toBe(fnv1a("the rules"));
  });

  it("always returns eight hex digits, empty input included", () => {
    for (const text of ["", "a", "a much longer sentence with §5c and ui/core in it"]) {
      expect(fnv1a(text)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("distinguishes text that differs only above the ASCII range", () => {
    expect(fnv1a("§5c")).not.toBe(fnv1a("§5d"));
    expect(fnv1a("café")).not.toBe(fnv1a("cafe"));
  });
});
