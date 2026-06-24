import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { checkCrossOriginProtection, crossOriginProtection, originProtection } from "./cop";
import type { OriginProtectionOptions } from "./types";

function makeApp(opts?: Parameters<typeof crossOriginProtection>[0]) {
  const app = new Forge();
  app.use("*", crossOriginProtection(opts));
  mapHandler(app, "ANY", "/test", () => new Response("ok"));
  return app;
}

const ALLOWED = "https://app.example.com";

function makeOriginApp(opts: OriginProtectionOptions = { allowedOrigins: [ALLOWED] }) {
  const app = new Forge();
  app.use("*", originProtection(opts));
  mapHandler(app, "ANY", "/test", () => new Response("ok"));
  return app;
}

describe("checkCrossOriginProtection", () => {
  it("allows GET regardless of Sec-Fetch-Site", () => {
    const req = new Request("https://example.com/test", { method: "GET", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows HEAD regardless of Sec-Fetch-Site", () => {
    const req = new Request("https://example.com/test", { method: "HEAD", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows OPTIONS regardless of Sec-Fetch-Site", () => {
    const req = new Request("https://example.com/test", { method: "OPTIONS", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows POST with Sec-Fetch-Site: same-origin", () => {
    const req = new Request("https://example.com/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows POST with Sec-Fetch-Site: same-site", () => {
    const req = new Request("https://example.com/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-site" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows POST with Sec-Fetch-Site: none (direct navigation)", () => {
    const req = new Request("https://example.com/test", { method: "POST", headers: { "Sec-Fetch-Site": "none" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("blocks POST with Sec-Fetch-Site: cross-site", () => {
    const req = new Request("https://example.com/test", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: false, reason: "cross-site" });
  });

  it("blocks POST when Sec-Fetch-Site is absent (fail-closed default)", () => {
    const req = new Request("https://example.com/test", { method: "POST" });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: false, reason: "missing-fetch-metadata" });
  });

  it("allows POST when Sec-Fetch-Site is absent and allowMissingHeader: true", () => {
    const req = new Request("https://example.com/test", { method: "POST" });
    expect(checkCrossOriginProtection(req, { allowMissingHeader: true })).toEqual({ ok: true });
  });
});

describe("crossOriginProtection middleware", () => {
  it("allows GET from cross-site (safe method)", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "GET", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(200);
  });

  it("allows POST from same-origin", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(res.status).toBe(200);
  });

  it("returns 403 for POST from cross-site", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("returns 403 for DELETE with no Sec-Fetch-Site (fail-closed default)", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("allows DELETE with no Sec-Fetch-Site when allowMissingHeader: true", async () => {
    const app = makeApp({ allowMissingHeader: true });
    const res = await app.request("/test", { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});

describe("originProtection middleware", () => {
  it("returns 403 for POST with Sec-Fetch-Site: cross-site (regardless of Origin)", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site", Origin: ALLOWED } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("allows POST with Sec-Fetch-Site: same-origin (COP authoritative, no Origin)", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(res.status).toBe(200);
  });

  it("allows POST with Sec-Fetch-Site: same-origin even when Origin is disallowed (COP authoritative)", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin", Origin: "https://evil.example.com" } });
    expect(res.status).toBe(200);
  });

  it("allows POST when Sec-Fetch-Site is absent and Origin is allowed", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { Origin: ALLOWED } });
    expect(res.status).toBe(200);
  });

  it("returns 403 when Sec-Fetch-Site is absent and Origin is disallowed", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { Origin: "https://evil.example.com" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("returns 403 when Sec-Fetch-Site, Origin, and Referer are all absent on POST", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("allows GET when Sec-Fetch-Site is absent (safe method exempt)", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("resolves allowedOrigins from the app context when given a resolver", async () => {
    const app = makeOriginApp({ allowedOrigins: () => [ALLOWED] });
    const allowed = await app.request("/test", { method: "POST", headers: { Origin: ALLOWED } });
    expect(allowed.status).toBe(200);
    const disallowed = await app.request("/test", { method: "POST", headers: { Origin: "https://evil.example.com" } });
    expect(disallowed.status).toBe(403);
  });
});
