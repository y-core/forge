import { describe, expect, it } from "bun:test";
import { hashString } from "./hash";

describe("hashString()", () => {
  it("returns 8-char hex string", () => {
    expect(hashString("hello")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic", () => {
    expect(hashString("test")).toBe(hashString("test"));
  });

  it("differs for different inputs", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("handles empty string", () => {
    expect(hashString("")).toMatch(/^[0-9a-f]{8}$/);
  });
});
