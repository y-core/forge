import { describe, expect, it } from "bun:test";
import { cn } from "./cn";

describe("cn", () => {
  it("joins multiple strings with a space", () => {
    expect(cn("foo", "bar", "baz")).toBe("foo bar baz");
  });

  it("returns an empty string when called with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("filters out false values", () => {
    expect(cn("foo", false, "bar")).toBe("foo bar");
  });

  it("filters out null values", () => {
    expect(cn("foo", null, "bar")).toBe("foo bar");
  });

  it("filters out undefined values", () => {
    expect(cn("foo", undefined, "bar")).toBe("foo bar");
  });

  it("filters out empty strings", () => {
    expect(cn("foo", "", "bar")).toBe("foo bar");
  });

  it("returns an empty string when all values are falsy", () => {
    expect(cn(false, null, undefined, "")).toBe("");
  });

  it("returns a single class unchanged", () => {
    expect(cn("only")).toBe("only");
  });
});
