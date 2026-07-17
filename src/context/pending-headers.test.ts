import { describe, expect, it } from "bun:test";
import { createTestContext } from "../testing/context";
import { applyPendingHeaders, setPendingHeader } from "./pending-headers";

describe("setPendingHeader / applyPendingHeaders", () => {
  it("preserves two appended set-cookie values as distinct cookies on the response", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "set-cookie", "session=abc; Path=/; HttpOnly", { append: true });
    setPendingHeader(c, "set-cookie", "theme=dark; Path=/; SameSite=Lax", { append: true });

    const res = applyPendingHeaders(c, new Response("body"));

    // getSetCookie() returns each cookie individually — they must not be comma-joined.
    expect(res.headers.getSetCookie()).toEqual(["session=abc; Path=/; HttpOnly", "theme=dark; Path=/; SameSite=Lax"]);
  });

  it("set-overwrites a single-valued header so it appears exactly once (no duplication)", () => {
    const c = createTestContext(new Request("http://test/"));
    setPendingHeader(c, "content-security-policy", "default-src 'self'");

    // Response already carries a CSP; the pending one must replace it, not stack/comma-join.
    const res = applyPendingHeaders(c, new Response("body", { headers: { "content-security-policy": "default-src 'none'" } }));

    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect([...res.headers].filter(([name]) => name === "content-security-policy")).toHaveLength(1);
  });

  it("returns the original response unchanged when no headers are pending", async () => {
    const c = createTestContext(new Request("http://test/"));
    const original = new Response("hello", { status: 201, headers: { "x-test": "kept" } });

    const res = applyPendingHeaders(c, original);

    expect(res).toBe(original);
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("hello");
    expect(res.headers.get("x-test")).toBe("kept");
  });
});
