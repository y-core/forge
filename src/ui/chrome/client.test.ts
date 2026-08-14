import { describe, expect, it } from "bun:test";
import { isDark } from "./client";

describe("isDark — stable accessor", () => {
  it("reads false until the theme scope resumes (no theme scope resumed here)", () => {
    expect(isDark.value).toBe(false);
  });
});
