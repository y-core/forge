import { describe, expect, it } from "bun:test";
import { createHref, joinPatterns } from "./mod";

describe("createHref re-export (F4)", () => {
  it("substitutes path params into the pattern", () => {
    expect(createHref("/users/:id", { id: "42" })).toBe("/users/42");
  });
});

describe("joinPatterns re-export (F4)", () => {
  it("is re-exported as a function", () => {
    expect(typeof joinPatterns).toBe("function");
  });
});
