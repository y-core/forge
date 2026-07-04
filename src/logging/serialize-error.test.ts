import { describe, expect, it } from "bun:test";
import { serializeError } from "./serialize-error";

describe("serializeError", () => {
  it("serializes an Error with name, message, and stack", () => {
    const result = serializeError(new Error("boom"));
    expect(result.name).toBe("Error");
    expect(result.message).toBe("boom");
    expect(typeof result.stack).toBe("string");
  });

  it("preserves Error subclass names", () => {
    const result = serializeError(new TypeError("bad type"));
    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("bad type");
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
    expect(serializeError(err).name).toBe("Error");
  });

  it("handles a thrown string", () => {
    const result = serializeError("just a string");
    expect(result.name).toBe("string");
    expect(result.message).toBe("just a string");
    expect("stack" in result).toBe(false);
  });

  it("handles thrown null and undefined", () => {
    expect(serializeError(null)).toStrictEqual({ name: "object", message: "null" });
    expect(serializeError(undefined)).toStrictEqual({ name: "undefined", message: "undefined" });
  });

  it("handles a thrown number", () => {
    expect(serializeError(42)).toStrictEqual({ name: "number", message: "42" });
  });

  it("never throws — a hostile toString degrades to a placeholder", () => {
    const hostile = {
      toString(): string {
        throw new Error("gotcha");
      },
    };
    const result = serializeError(hostile);
    expect(result.name).toBe("object");
    expect(result.message).toBe("[unserializable thrown value]");
  });

  it("result is JSON-serializable", () => {
    expect(() => JSON.stringify(serializeError(new Error("x")))).not.toThrow();
  });
});
