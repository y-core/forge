import { describe, expect, it } from "bun:test";

import { isUnsatisfiableRange, UnsatisfiableRangeError } from "./errors";

describe("UnsatisfiableRangeError", () => {
  it("names the key in its message and carries it as a property", () => {
    const err = new UnsatisfiableRangeError("uploads/a.txt");
    expect(err.message).toBe('Range not satisfiable for "uploads/a.txt"');
    expect(err.key).toBe("uploads/a.txt");
    expect(err.name).toBe("UnsatisfiableRangeError");
    expect(err).toBeInstanceOf(Error);
  });

  it("leaves size and cause undefined when no options are given", () => {
    const err = new UnsatisfiableRangeError("k");
    expect(err.size).toBe(undefined);
    expect(err.cause).toBe(undefined);
  });

  it("carries the object size when supplied", () => {
    expect(new UnsatisfiableRangeError("k", { size: 0 }).size).toBe(0);
  });

  it("carries the underlying platform error as its cause", () => {
    const cause = new Error("r2 said no");
    expect(new UnsatisfiableRangeError("k", { cause }).cause).toBe(cause);
  });

  it("omits cause entirely when only size is supplied", () => {
    const err = new UnsatisfiableRangeError("k", { size: 12 });
    expect("cause" in err).toBe(false);
  });
});

describe("isUnsatisfiableRange", () => {
  it("recognizes the numeric R2 code", () => {
    expect(isUnsatisfiableRange({ code: 10039, message: "unrelated wording" })).toBe(true);
  });

  it("recognizes the message wording in either spelling, case-insensitively", () => {
    expect(isUnsatisfiableRange(new Error("The requested range is not satisfiable"))).toBe(true);
    expect(isUnsatisfiableRange(new Error("R2 error: InvalidRange"))).toBe(true);
    expect(isUnsatisfiableRange(new Error("invalidrange"))).toBe(true);
  });

  it("rejects a TypeError, which is R2 refusing the option value rather than the range", () => {
    expect(isUnsatisfiableRange(new TypeError("range is not satisfiable"))).toBe(false);
  });

  it("rejects an unrelated error", () => {
    expect(isUnsatisfiableRange(new Error("network timeout"))).toBe(false);
  });

  it("rejects a non-object thrown value", () => {
    for (const value of [null, undefined, "range is not satisfiable", 10039]) {
      expect(isUnsatisfiableRange(value)).toBe(false);
    }
  });

  it("rejects an object whose message is not a string", () => {
    expect(isUnsatisfiableRange({ message: { toString: () => "InvalidRange" } })).toBe(false);
  });

  it("rejects a code that only looks like the R2 one as a string", () => {
    expect(isUnsatisfiableRange({ code: "10039" })).toBe(false);
  });
});
