import { describe, expect, it } from "bun:test";

import { serializeError } from "./serialize-error";

describe("serializeError", () => {
  it("serializes an Error with type, detail, and stack", () => {
    const result = serializeError(new Error("boom"));
    expect(result.type).toBe("Error");
    expect(result.detail).toBe("boom");
    expect(typeof result.stack).toBe("string");
  });

  it("preserves Error subclass names", () => {
    const result = serializeError(new TypeError("bad type"));
    expect(result.type).toBe("TypeError");
    expect(result.detail).toBe("bad type");
  });

  it("omits stack when the Error has none", () => {
    const err = new Error("no stack");
    delete err.stack;
    const result = serializeError(err);
    expect("stack" in result).toBe(false);
  });

  it("falls back to 'Error' when the name is empty", () => {
    const err = new Error("anon");
    err.name = "";
    expect(serializeError(err).type).toBe("Error");
  });

  it("handles a thrown string", () => {
    const result = serializeError("just a string");
    expect(result.type).toBe("string");
    expect(result.detail).toBe("just a string");
    expect("stack" in result).toBe(false);
  });

  it("handles thrown null and undefined", () => {
    expect(serializeError(null)).toStrictEqual({ type: "object", detail: "null" });
    expect(serializeError(undefined)).toStrictEqual({ type: "undefined", detail: "undefined" });
  });

  it("handles a thrown number", () => {
    expect(serializeError(42)).toStrictEqual({ type: "number", detail: "42" });
  });

  it("never throws — a hostile toString degrades to a placeholder", () => {
    const hostile = {
      toString(): string {
        throw new Error("gotcha");
      },
    };
    const result = serializeError(hostile);
    expect(result.type).toBe("object");
    expect(result.detail).toBe("[unserializable thrown value]");
  });

  it("result is JSON-serializable", () => {
    expect(() => JSON.stringify(serializeError(new Error("x")))).not.toThrow();
  });
});
