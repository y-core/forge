import { describe, expect, it } from "bun:test";

import { Forge } from "../app/forge-app";
import { mapHandler } from "../testing/route";
import { isExemptFromOriginCheck, originGuard, verifyOrigin } from "./origin";

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
});

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
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(isExemptFromOriginCheck(request(method))).toBe(true);
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
