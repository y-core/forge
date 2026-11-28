import { describe, expect, it } from "bun:test";

import { defineRules } from "./define";
import type { RuleEntry } from "./types";

describe("defineRules()", () => {
  it("returns the entries it was given, unchanged", () => {
    const entries: RuleEntry[] = [{ id: "forge-x", statement: "Never do x.", detectors: [{ kind: "review" }] }];

    expect(defineRules(entries)).toBe(entries);
  });
});
