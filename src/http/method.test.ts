import { describe, expect, it } from "bun:test";

import { isSafeHttpMethod } from "./method";

describe("isSafeHttpMethod", () => {
  it("answers true for GET, HEAD, OPTIONS and TRACE", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "TRACE"]) expect(isSafeHttpMethod(method)).toBe(true);
  });

  it("answers false for a method that changes state", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "CONNECT"]) expect(isSafeHttpMethod(method)).toBe(false);
  });

  it("ignores the case of the method", () => {
    for (const method of ["get", "Head", "options", "tRaCe"]) expect(isSafeHttpMethod(method)).toBe(true);
    expect(isSafeHttpMethod("post")).toBe(false);
  });

  it("answers false for a method it does not know", () => {
    expect(isSafeHttpMethod("ANY")).toBe(false);
    expect(isSafeHttpMethod("")).toBe(false);
  });
});
