import { describe, expect, it } from "bun:test";
import { bumpSemVer, compareSemVer, formatSemVer, isGreaterThan, parseSemVer } from "./semver";

describe("parseSemVer()", () => {
  it("parses a plain three-part version", () => {
    expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("strips a leading v prefix", () => {
    expect(parseSemVer("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("parses 0.0.0", () => {
    expect(parseSemVer("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it("returns null for a two-part string", () => {
    expect(parseSemVer("1.2")).toBeNull();
  });

  it("returns null for a non-numeric part", () => {
    expect(parseSemVer("1.2.a")).toBeNull();
  });

  it("returns null for leading zeros", () => {
    expect(parseSemVer("01.2.3")).toBeNull();
  });

  it("returns null for empty parts", () => {
    expect(parseSemVer("1..3")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseSemVer("")).toBeNull();
  });

  it("returns null for a bare word", () => {
    expect(parseSemVer("foo")).toBeNull();
  });
});

describe("formatSemVer()", () => {
  it("formats a version without a v prefix", () => {
    expect(formatSemVer({ major: 1, minor: 2, patch: 3 })).toBe("1.2.3");
  });

  it("formats 0.0.0 correctly", () => {
    expect(formatSemVer({ major: 0, minor: 0, patch: 0 })).toBe("0.0.0");
  });
});

describe("compareSemVer()", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemVer({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 })).toBe(0);
  });

  it("returns 1 when a is greater by patch", () => {
    expect(compareSemVer({ major: 1, minor: 2, patch: 4 }, { major: 1, minor: 2, patch: 3 })).toBe(1);
  });

  it("returns -1 when a is lesser by patch", () => {
    expect(compareSemVer({ major: 1, minor: 2, patch: 2 }, { major: 1, minor: 2, patch: 3 })).toBe(-1);
  });

  it("returns 1 when a is greater by minor", () => {
    expect(compareSemVer({ major: 1, minor: 3, patch: 0 }, { major: 1, minor: 2, patch: 9 })).toBe(1);
  });

  it("returns 1 when a is greater by major", () => {
    expect(compareSemVer({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 })).toBe(1);
  });
});

describe("isGreaterThan()", () => {
  it("returns true when next > prev", () => {
    expect(isGreaterThan({ major: 1, minor: 0, patch: 1 }, { major: 1, minor: 0, patch: 0 })).toBe(true);
  });

  it("returns false when equal", () => {
    expect(isGreaterThan({ major: 1, minor: 0, patch: 0 }, { major: 1, minor: 0, patch: 0 })).toBe(false);
  });

  it("returns false when next < prev", () => {
    expect(isGreaterThan({ major: 0, minor: 9, patch: 9 }, { major: 1, minor: 0, patch: 0 })).toBe(false);
  });
});

describe("bumpSemVer()", () => {
  it("bumps patch and keeps major/minor", () => {
    expect(bumpSemVer({ major: 1, minor: 2, patch: 3 }, "patch")).toEqual({ major: 1, minor: 2, patch: 4 });
  });

  it("bumps minor and resets patch", () => {
    expect(bumpSemVer({ major: 1, minor: 2, patch: 3 }, "minor")).toEqual({ major: 1, minor: 3, patch: 0 });
  });

  it("bumps major and resets minor and patch", () => {
    expect(bumpSemVer({ major: 1, minor: 2, patch: 3 }, "major")).toEqual({ major: 2, minor: 0, patch: 0 });
  });
});
