import { describe, expect, it } from "bun:test";
import { RequestContext } from "@remix-run/fetch-router";
import { contextVar } from "./accessor";

function makeCtx() {
  return new RequestContext(new Request("http://localhost/"));
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
