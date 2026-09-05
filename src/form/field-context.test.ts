import { describe, expect, it } from "bun:test";

import { createTestContext } from "../testing/context";
import { csrfFieldCtx } from "./field-context";

const context = () => createTestContext(new Request("http://test/x"));

describe("csrfFieldCtx", () => {
  it("reads back the field name it was set to", () => {
    const c = context();
    csrfFieldCtx.set(c, "csrf_token");
    expect(csrfFieldCtx.get(c)).toBe("csrf_token");
  });

  it("throws a named error when read before it is set", () => {
    expect(() => csrfFieldCtx.get(context())).toThrow('Context variable "csrfField" is not set');
  });

  it("throws the caller's message when one is supplied", () => {
    expect(() => csrfFieldCtx.get(context(), "csrfProtection did not run")).toThrow("csrfProtection did not run");
  });

  it("yields undefined from getOptional before it is set", () => {
    expect(csrfFieldCtx.getOptional(context())).toBe(undefined);
  });

  it("yields the value from getOptional once set", () => {
    const c = context();
    csrfFieldCtx.set(c, "csrf_token");
    expect(csrfFieldCtx.getOptional(c)).toBe("csrf_token");
  });

  it("keeps each request's value on its own context", () => {
    const first = context();
    const second = context();
    csrfFieldCtx.set(first, "csrf_token");
    expect(csrfFieldCtx.getOptional(second)).toBe(undefined);
  });

  it("overwrites a previously set value", () => {
    const c = context();
    csrfFieldCtx.set(c, "csrf_token");
    csrfFieldCtx.set(c, "_csrf");
    expect(csrfFieldCtx.get(c)).toBe("_csrf");
  });
});
