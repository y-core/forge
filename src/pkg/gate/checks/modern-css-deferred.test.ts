import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MODERN_CSS_DEFERRED } from "./modern-css-deferred";
import { MODERN_CSS_RULES } from "./modern-css-rules";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("MODERN_CSS_DEFERRED", () => {
  it("names an owner on every entry", () => {
    expect(MODERN_CSS_DEFERRED.filter((entry) => entry.owner.trim() === "").map((entry) => entry.path)).toEqual([]);
  });

  it("names a rule the table defines on every entry", () => {
    expect(MODERN_CSS_DEFERRED.filter((entry) => MODERN_CSS_RULES[entry.ruleId] === undefined).map((entry) => entry.path)).toEqual([]);
  });

  it("names a path that exists on every entry", () => {
    expect(MODERN_CSS_DEFERRED.filter((entry) => !existsSync(resolve(ROOT, entry.path))).map((entry) => entry.path)).toEqual([]);
  });

  it("carries no duplicate path and rule pair", () => {
    const keys = MODERN_CSS_DEFERRED.map((entry) => `${entry.path} ${entry.ruleId}`);

    expect(keys.length).toBe(new Set(keys).size);
  });
});
