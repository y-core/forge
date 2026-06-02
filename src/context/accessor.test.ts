import { describe, expect, it } from "bun:test";
import type { Context } from "hono";
import { contextVar } from "./accessor";

function makeCtx(): Context {
  const vars: Record<string, unknown> = {};
  return {
    get: (k: string) => vars[k],
    set: (k: string, v: unknown) => {
      vars[k] = v;
    },
  } as unknown as Context;
}

describe("contextVar", () => {
  describe("get", () => {
    it("returns the value after set", () => {
      const c = makeCtx();
      const v = contextVar<string>("test-key");
      v.set(c, "hello");
      expect(v.get(c)).toBe("hello");
    });

    it("throws with the default key-named message when not set", () => {
      const c = makeCtx();
      const v = contextVar<string>("my-key");
      expect(() => v.get(c)).toThrow('Context variable "my-key" is not set');
    });

    it("throws with a custom message when provided", () => {
      const c = makeCtx();
      const v = contextVar<string>("my-key");
      expect(() => v.get(c, "custom error message")).toThrow("custom error message");
    });
  });

  describe("getOptional", () => {
    it("returns undefined when not set", () => {
      const c = makeCtx();
      const v = contextVar<string>("my-key");
      expect(v.getOptional(c)).toBeUndefined();
    });

    it("returns the value after set", () => {
      const c = makeCtx();
      const v = contextVar<string>("test-key");
      v.set(c, "hello");
      expect(v.getOptional(c)).toBe("hello");
    });
  });
});
