import { describe, expect, it } from "bun:test";

import { createTestContext } from "../testing/context";
import { csrfFieldCtx, csrfHeaderCtx } from "./csrf-context";

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

describe("csrfHeaderCtx", () => {
  it("reads back the header name it was set to", () => {
    const c = context();
    csrfHeaderCtx.set(c, "X-App-Csrf");
    expect(csrfHeaderCtx.get(c)).toBe("X-App-Csrf");
  });

  it("throws a named error when read before it is set", () => {
    expect(() => csrfHeaderCtx.get(context())).toThrow('Context variable "csrfHeader" is not set');
  });

  it("yields undefined from getOptional before it is set", () => {
    expect(csrfHeaderCtx.getOptional(context())).toBe(undefined);
  });

  it("keeps its own key, distinct from the field name", () => {
    const c = context();
    csrfFieldCtx.set(c, "_csrf");
    csrfHeaderCtx.set(c, "X-CSRF-Token");
    expect([csrfFieldCtx.get(c), csrfHeaderCtx.get(c)]).toEqual(["_csrf", "X-CSRF-Token"]);
  });
});
