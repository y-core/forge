import { describe, expect, it } from "bun:test";

import { canonVersion } from "./version";

describe("canonVersion()", () => {
  it("reads the installed forge version, which is the only way the canon changes in a consumer", () => {
    expect(canonVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("is stable across calls, so an index stamped with it is not invalidated by reading it twice", () => {
    expect(canonVersion()).toBe(canonVersion());
  });
});
