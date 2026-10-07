import { describe, expect, it } from "bun:test";

import { createTestContext } from "../testing/context";
import { mergePendingHeaders, setPendingHeader } from "./pending-headers";

describe("setPendingHeader / mergePendingHeaders", () => {
  it("preserves two appended set-cookie values as distinct cookies on the response", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "set-cookie", "session=abc; Path=/; HttpOnly", { append: true });
    setPendingHeader(c, "set-cookie", "theme=dark; Path=/; SameSite=Lax", { append: true });

    const headers = mergePendingHeaders(c, new Response("body"));

    expect(headers?.getSetCookie()).toEqual(["session=abc; Path=/; HttpOnly", "theme=dark; Path=/; SameSite=Lax"]);
  });

  it("set-overwrites a single-valued header so it appears exactly once (no duplication)", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "referrer-policy", "strict-origin-when-cross-origin");

    const headers = mergePendingHeaders(c, new Response("body", { headers: { "referrer-policy": "unsafe-url" } }));

    expect(headers?.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect([...(headers ?? [])].filter(([name]) => name === "referrer-policy")).toHaveLength(1);
  });

  it("combines a response's own CSP after the queued one", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "content-security-policy", "default-src 'self'");

    const headers = mergePendingHeaders(c, new Response("body", { headers: { "content-security-policy": "default-src 'none'" } }));

    expect(headers?.get("content-security-policy")).toBe("default-src 'self', default-src 'none'");
    expect([...(headers ?? [])].filter(([name]) => name === "content-security-policy")).toHaveLength(1);
  });

  it("leaves a response's own CSP untouched when only other headers are queued", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "referrer-policy", "no-referrer");

    const headers = mergePendingHeaders(c, new Response("body", { headers: { "content-security-policy": "sandbox" } }));

    expect(headers?.get("content-security-policy")).toBe("sandbox");
  });

  it("returns null when no headers are pending", () => {
    const c = createTestContext(new Request("http://test/"));

    expect(mergePendingHeaders(c, new Response("hello", { headers: { "x-test": "kept" } }))).toBeNull();
  });

  it("keeps the response's own headers beside the queued ones", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "referrer-policy", "no-referrer");

    const headers = mergePendingHeaders(c, new Response("body", { headers: { "x-test": "kept" } }));

    expect(headers?.get("x-test")).toBe("kept");
    expect(headers?.get("referrer-policy")).toBe("no-referrer");
  });
});
