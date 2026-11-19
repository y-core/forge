import { describe, expect, it } from "bun:test";

import { Forge } from "../app/forge-app";
import { RequestContext } from "../context/types";
import { createTestContext } from "../testing/context";
import { mapHandler } from "../testing/route";
import * as securityBarrel from "./mod";
import { isExemptFromOriginCheck, originGuard, verifyOrigin, withExtraOrigins } from "./origin";
import { readDevOrigins } from "./url.dev";

function makeApp(allowed: string[]) {
  const app = new Forge();
  app.use("*", originGuard(allowed));
  mapHandler(app, "ANY", "/test", () => new Response("ok"));
  return app;
}

describe("originGuard middleware", () => {
  const ALLOWED = ["https://example.com"];

  it("allows a request with a matching Origin", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "POST", headers: { Origin: "https://example.com" } });
    expect(res.status).toBe(200);
  });

  it("returns 403 for a mismatched Origin", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "POST", headers: { Origin: "https://evil.com" } });
    expect(res.status).toBe(403);
  });

  it("returns 403 when both Origin and Referer are missing on POST", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("GET without Origin or Referer passes (safe method)", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("HEAD without Origin or Referer passes (safe method)", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  it("lets OPTIONS and TRACE from a foreign Origin through as safe methods", async () => {
    const app = makeApp(ALLOWED);
    for (const method of ["OPTIONS", "TRACE"]) {
      const res = await app.request("/test", { method, headers: { Origin: "https://evil.com" } });
      expect({ method, status: res.status, body: await res.text() }).toEqual({ method, status: 200, body: "ok" });
    }
  });

  it("refuses PUT, PATCH and DELETE from a foreign Origin with 403 Forbidden", async () => {
    const app = makeApp(ALLOWED);
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await app.request("/test", { method, headers: { Origin: "https://evil.com" } });
      expect({ method, status: res.status, body: await res.text() }).toEqual({ method, status: 403, body: "Forbidden" });
    }
  });

  it("judges a method by its meaning, not its case: a lowercase safe method passes and a lowercase unsafe one is refused", async () => {
    const results: Record<string, { status: number; body: string }> = {};
    for (const method of ["options", "get", "patch", "delete", "post"]) {
      const context = createTestContext(deliveredAs(method, { headers: { Origin: "https://evil.com" } }));
      const res = await originGuard(ALLOWED)(context as never, async () => new Response("ok"));
      results[method] = { status: res.status, body: await res.text() };
    }
    expect(results).toEqual({
      options: { status: 200, body: "ok" },
      get: { status: 200, body: "ok" },
      patch: { status: 403, body: "Forbidden" },
      delete: { status: 403, body: "Forbidden" },
      post: { status: 403, body: "Forbidden" },
    });
  });
});

// Bun's Request rewrites a non-canonical method to GET; Workers hands `patch` or an extension method through as sent.
function deliveredAs(method: string, init: RequestInit = {}): Request {
  return Object.defineProperty(new Request("https://example.com/test", init), "method", { value: method });
}

describe("originGuard on a WebSocket upgrade", () => {
  const ALLOWED = ["https://example.com"];
  const UPGRADE = { Upgrade: "websocket", Connection: "Upgrade" };

  it("passes a same-origin upgrade", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "GET", headers: { ...UPGRADE, Origin: "https://example.com" } });
    expect(res.status).toBe(200);
  });

  it("returns 403 for an upgrade from a foreign Origin", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "GET", headers: { ...UPGRADE, Origin: "https://evil.com" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("returns 403 for an upgrade with no Origin, even beside an allowed Referer", async () => {
    const app = makeApp(ALLOWED);
    const bare = await app.request("/test", { method: "GET", headers: UPGRADE });
    expect(bare.status).toBe(403);
    const withReferer = await app.request("/test", { method: "GET", headers: { ...UPGRADE, Referer: "https://example.com/page" } });
    expect(withReferer.status).toBe(403);
  });

  it("leaves a plain GET from a foreign Origin unchecked", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "GET", headers: { Origin: "https://evil.com" } });
    expect(res.status).toBe(200);
  });
});

describe("isExemptFromOriginCheck", () => {
  const request = (method: string, headers: Record<string, string> = {}) => new Request("https://example.com/live", { method, headers });

  it("exempts a safe method that is not an upgrade", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "TRACE"]) expect(isExemptFromOriginCheck(request(method))).toBe(true);
  });

  it("exempts a safe method whatever its case, and holds an unsafe one whatever its case", () => {
    const verdicts = Object.fromEntries(
      ["trace", "Options", "patch", "Delete"].map((method) => [method, isExemptFromOriginCheck(deliveredAs(method))]),
    );
    expect(verdicts).toEqual({ trace: true, Options: true, patch: false, Delete: false });
  });

  it("holds PUT, PATCH and DELETE to the check", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) expect(isExemptFromOriginCheck(request(method))).toBe(false);
  });

  it("holds a WebSocket upgrade and a state-changing method to the check", () => {
    expect(isExemptFromOriginCheck(request("GET", { Upgrade: "websocket" }))).toBe(false);
    expect(isExemptFromOriginCheck(request("POST"))).toBe(false);
  });
});

const ALLOWED = ["https://example.com", "https://www.example.com"];

describe("verifyOrigin", () => {
  it("allows a matching Origin header", () => {
    const req = new Request("https://example.com/api/contact", { method: "POST", headers: { Origin: "https://example.com" } });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: true });
  });

  it("rejects a disallowed Origin", () => {
    const req = new Request("https://example.com/api/contact", { method: "POST", headers: { Origin: "https://evil.com" } });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, error: "disallowed" });
  });

  it("falls back to Referer when Origin is absent and Referer matches", () => {
    const req = new Request("https://example.com/api/contact", { method: "POST", headers: { Referer: "https://example.com/page" } });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: true });
  });

  it("rejects when Referer origin does not match", () => {
    const req = new Request("https://example.com/api/contact", { method: "POST", headers: { Referer: "https://evil.com/page" } });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, error: "disallowed" });
  });

  it("rejects when both Origin and Referer are absent", () => {
    const req = new Request("https://example.com/api/contact", { method: "POST" });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, error: "missing" });
  });

  it("Origin takes precedence over Referer", () => {
    const req = new Request("https://example.com/api/contact", {
      method: "POST",
      headers: { Origin: "https://evil.com", Referer: "https://example.com/page" },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, error: "disallowed" });
  });

  it("returns missing for GET requests without Origin (no safe-method bypass)", () => {
    const req = new Request("https://example.com/api/contact", { method: "GET" });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, error: "missing" });
  });

  it("returns missing for HEAD requests without Origin (no safe-method bypass)", () => {
    const req = new Request("https://example.com/api/contact", { method: "HEAD" });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, error: "missing" });
  });

  it("ignores a Referer on a WebSocket upgrade and returns missing", () => {
    const req = new Request("https://example.com/live", { headers: { Upgrade: "websocket", Referer: "https://example.com/page" } });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, error: "missing" });
  });
});

describe("withExtraOrigins", () => {
  const TUNNEL = "https://tunnel.example";
  const CONFIGURED = ["https://example.com"];
  const request = new Request("https://example.com/test", { method: "POST" });

  it("appends the origins the relaxation reads from this request's bindings", () => {
    const context = createTestContext(request, { env: { FORGE_DEV_ORIGINS: TUNNEL } });
    expect(withExtraOrigins(context, CONFIGURED, readDevOrigins)).toEqual([...CONFIGURED, TUNNEL]);
  });

  it("returns the allowlist itself when the relaxation finds nothing", () => {
    const context = createTestContext(request, { env: {} });
    expect(withExtraOrigins(context, CONFIGURED, readDevOrigins)).toBe(CONFIGURED);
  });

  it("stays strict on a bare router, which carries no bindings", () => {
    expect(withExtraOrigins(new RequestContext(request), CONFIGURED, readDevOrigins)).toBe(CONFIGURED);
  });

  it("appends nothing by default in a build not armed for development, whatever `FORGE_DEV_ORIGINS` names", () => {
    const context = createTestContext(request, { env: { FORGE_DEV_ORIGINS: TUNNEL } });
    expect(withExtraOrigins(context, CONFIGURED)).toBe(CONFIGURED);
  });

  it("leaves `originGuard` refusing a `FORGE_DEV_ORIGINS` origin in a build not armed for development", async () => {
    const res = await makeApp(CONFIGURED).request("/test", { method: "POST", headers: { Origin: TUNNEL } }, { FORGE_DEV_ORIGINS: TUNNEL });
    expect(res.status).toBe(403);
  });
});

describe("withExtraOrigins on the barrel", () => {
  it("stays off the security barrel, so no consumer reaches the relaxation", () => {
    expect(Object.values<unknown>(securityBarrel).includes(withExtraOrigins)).toBe(false);
  });
});
