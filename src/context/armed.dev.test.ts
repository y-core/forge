import { describe, expect, it } from "bun:test";

import { isDevBuildArmed, whenArmed } from "./armed.dev";

describe("isDevBuildArmed", () => {
  it("is false in a run that defines no `__FORGE_DEV__`", () => {
    expect(isDevBuildArmed()).toBe(false);
  });
});

describe("whenArmed", () => {
  const relaxed = (value: number): string => `relaxed ${value}`;
  const strict = (value: number): string => `strict ${value}`;

  it("answers with the relaxed function while armed", () => {
    expect(whenArmed(() => true, relaxed, strict)(1)).toBe("relaxed 1");
  });

  it("answers with the strict function while unarmed", () => {
    expect(whenArmed(() => false, relaxed, strict)(2)).toBe("strict 2");
  });
});
