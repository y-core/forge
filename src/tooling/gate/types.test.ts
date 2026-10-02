import { describe, expect, it } from "bun:test";

import { GATE_MODES } from "./types";

describe("GATE_MODES", () => {
  it("is the three tiers in ascending order, which is what the selector ranks against", () => {
    expect([...GATE_MODES]).toEqual(["quality", "standard", "full"]);
  });
});
