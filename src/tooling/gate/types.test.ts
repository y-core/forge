import { describe, expect, it } from "bun:test";

import { GATE_TIERS } from "./types";

describe("GATE_TIERS", () => {
  it("is the tiers in ascending order, which is what the selector ranks against", () => {
    expect([...GATE_TIERS]).toEqual(["static", "unit", "runtime", "scheduled"]);
  });
});
