import { describe, expect, it } from "bun:test";
import { env, flag, resolveDefine } from "./config";

describe("resolveDefine()", () => {
  const src: Record<string, string | undefined> = { DEFINED: "hello", TRUTH: "true", ONE: "1", FALSY: "0" };

  it("string literal", () => expect(resolveDefine("hello", src)).toBe('"hello"'));
  it("number literal", () => expect(resolveDefine(42, src)).toBe("42"));
  it("boolean true", () => expect(resolveDefine(true, src)).toBe("true"));
  it("boolean false", () => expect(resolveDefine(false, src)).toBe("false"));
  it("null", () => expect(resolveDefine(null, src)).toBe("null"));

  describe("env()", () => {
    it("set var → JSON-stringified value", () => expect(resolveDefine(env("DEFINED"), src)).toBe('"hello"'));
    it("unset var → undefined literal", () => expect(resolveDefine(env("MISSING"), src)).toBe("undefined"));
  });

  describe("flag()", () => {
    it('"true" → true', () => expect(resolveDefine(flag("TRUTH"), src)).toBe("true"));
    it('"1" → true', () => expect(resolveDefine(flag("ONE"), src)).toBe("true"));
    it('"0" → false', () => expect(resolveDefine(flag("FALSY"), src)).toBe("false"));
    it("unset → false", () => expect(resolveDefine(flag("MISSING"), src)).toBe("false"));
  });
});
