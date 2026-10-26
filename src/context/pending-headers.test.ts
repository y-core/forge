import { describe, expect, it } from "bun:test";

import { createTestContext } from "../testing/context";
import { mergePendingHeaders, pendingCookieValue, replacePendingCookie, setPendingHeader } from "./pending-headers";

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

describe("pendingCookieValue", () => {
  it("is null when nothing is queued", () => {
    const c = createTestContext(new Request("http://test/"));

    expect(pendingCookieValue(c, "flash")).toBeNull();
  });

  it("is null when only another cookie is queued", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "set-cookie", "session=abc", { append: true });

    expect(pendingCookieValue(c, "flash")).toBeNull();
  });

  it("is null for a cookie whose name only starts with the one asked for", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "set-cookie", "flashy=1", { append: true });

    expect(pendingCookieValue(c, "flash")).toBeNull();
  });

  it("reads the value of the last cookie queued under the name", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "set-cookie", "flash=one; Path=/", { append: true });
    setPendingHeader(c, "set-cookie", "flash=two; Path=/", { append: true });

    expect(pendingCookieValue(c, "flash")).toBe("two");
  });

  it("reads an empty value as the empty string, not null", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "set-cookie", "flash=", { append: true });

    expect(pendingCookieValue(c, "flash")).toBe("");
  });
});

describe("replacePendingCookie", () => {
  it("swaps the named cookie out while keeping the others in their order", () => {
    const c = createTestContext(new Request("http://test/"));
    for (const cookie of ["session=abc", "flash=one", "theme=dark"]) setPendingHeader(c, "set-cookie", cookie, { append: true });

    replacePendingCookie(c, "flash=two; Path=/");

    expect(mergePendingHeaders(c, new Response("body"))?.getSetCookie()).toEqual(["session=abc", "theme=dark", "flash=two; Path=/"]);
  });

  it("queues the cookie when nothing was queued before", () => {
    const c = createTestContext(new Request("http://test/"));

    replacePendingCookie(c, "flash=two; Path=/");

    expect(mergePendingHeaders(c, new Response("body"))?.getSetCookie()).toEqual(["flash=two; Path=/"]);
  });
});
