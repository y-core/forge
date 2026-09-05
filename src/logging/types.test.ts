import { describe, expect, it } from "bun:test";

import type { LogLevel } from "./types";
import { levelAtLeast, LOG_LEVELS, parseLogLevel, parseLogLevels } from "./types";

describe("LOG_LEVELS", () => {
  it("lists every level in severity order, least to most severe", () => {
    expect(LOG_LEVELS).toEqual(["debug", "info", "warn", "error"]);
  });
});

describe("levelAtLeast", () => {
  const cases: { level: LogLevel; min: LogLevel; expected: boolean }[] = [
    { level: "debug", min: "debug", expected: true },
    { level: "debug", min: "info", expected: false },
    { level: "debug", min: "error", expected: false },
    { level: "info", min: "debug", expected: true },
    { level: "info", min: "warn", expected: false },
    { level: "warn", min: "warn", expected: true },
    { level: "warn", min: "error", expected: false },
    { level: "error", min: "debug", expected: true },
    { level: "error", min: "error", expected: true },
  ];

  for (const { level, min, expected } of cases) {
    it(`${level} against a ${min} floor is ${expected}`, () => {
      expect(levelAtLeast(level, min)).toBe(expected);
    });
  }
});

describe("parseLogLevel", () => {
  it("accepts each known level", () => {
    for (const level of LOG_LEVELS) {
      expect(parseLogLevel(level, "error")).toBe(level);
    }
  });

  it("lowercases and trims before matching", () => {
    expect(parseLogLevel("  WARN \n", "error")).toBe("warn");
  });

  it("falls back on undefined", () => {
    expect(parseLogLevel(undefined, "info")).toBe("info");
  });

  it("falls back on an empty or whitespace-only string", () => {
    expect(parseLogLevel("", "info")).toBe("info");
    expect(parseLogLevel("   ", "info")).toBe("info");
  });

  it("falls back on an unknown level rather than trusting the environment", () => {
    expect(parseLogLevel("verbose", "warn")).toBe("warn");
  });

  it("falls back on a level list, which is not a single level", () => {
    expect(parseLogLevel("warn,error", "debug")).toBe("debug");
  });
});

describe("parseLogLevels", () => {
  it("parses a comma-separated list in the order given", () => {
    expect(parseLogLevels("error,debug", ["info"])).toEqual(["error", "debug"]);
  });

  it("lowercases and trims each part", () => {
    expect(parseLogLevels(" WARN , Error ", ["info"])).toEqual(["warn", "error"]);
  });

  it("yields an empty array for the none sentinel, silencing every level", () => {
    expect(parseLogLevels("none", ["info"])).toEqual([]);
  });

  it("treats the none sentinel case-insensitively", () => {
    expect(parseLogLevels(" NONE ", ["info"])).toEqual([]);
  });

  it("falls back on undefined", () => {
    expect(parseLogLevels(undefined, ["warn"])).toEqual(["warn"]);
  });

  it("falls back on an empty or whitespace-only string", () => {
    expect(parseLogLevels("", ["warn"])).toEqual(["warn"]);
    expect(parseLogLevels("   ", ["warn"])).toEqual(["warn"]);
  });

  it("falls back when no part is a known level", () => {
    expect(parseLogLevels("verbose,trace", ["warn"])).toEqual(["warn"]);
  });

  it("keeps the known parts and drops the unknown ones from a mixed list", () => {
    expect(parseLogLevels("warn,verbose,error", ["info"])).toEqual(["warn", "error"]);
  });

  it("drops empty parts from a trailing or doubled comma", () => {
    expect(parseLogLevels("warn,,error,", ["info"])).toEqual(["warn", "error"]);
  });

  it("keeps a duplicated level as written rather than de-duplicating", () => {
    expect(parseLogLevels("warn,warn", ["info"])).toEqual(["warn", "warn"]);
  });
});
