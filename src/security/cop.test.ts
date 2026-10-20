import { describe, expect, it } from "bun:test";

import { createRouter } from "@remix-run/fetch-router";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";

import { createApp } from "../app/app";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../testing/route";
import { checkCrossOriginProtection, crossOriginProtection, crossOriginVerdict, originProtection } from "./cop";
import * as securityBarrel from "./mod";
import type { OriginProtectionOptions } from "./types";

function makeApp() {
  return createApp({
    middleware: (app) => app.use("*", crossOriginProtection()),
    routes: (app) => mapHandler(app, "ANY", "/test", () => new Response("ok")),
  });
}

const ALLOWED = "https://app.example.com";
const UPGRADE = { Upgrade: "websocket", Connection: "Upgrade" };

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

  it("blocks POST with Sec-Fetch-Site: same-site (sibling subdomain)", () => {
    const req = new Request("https://example.com/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-site" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: false, error: "same-site" });
  });

  it("allows POST with Sec-Fetch-Site: none (direct navigation)", () => {
    const req = new Request("https://example.com/test", { method: "POST", headers: { "Sec-Fetch-Site": "none" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("blocks POST with Sec-Fetch-Site: cross-site", () => {
    const req = new Request("https://example.com/test", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: false, error: "cross-site" });
  });

  it("blocks POST with an unrecognised Sec-Fetch-Site value (allowlist, not denylist)", () => {
    const req = new Request("https://example.com/test", { method: "POST", headers: { "Sec-Fetch-Site": "totally-bogus" } });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: false, error: "cross-site" });
  });

  it("blocks POST when Sec-Fetch-Site is absent (fail-closed default)", () => {
    const req = new Request("https://example.com/test", { method: "POST" });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: false, error: "missing-fetch-metadata" });
  });

  it("takes no options, so only a development build relaxes it", () => {
    const req = new Request("https://example.com/test", { method: "POST" });
    // @ts-expect-error — `checkCrossOriginProtection` takes no `dev` option
    expect(checkCrossOriginProtection(req, { dev: true })).toEqual({ ok: false, error: "missing-fetch-metadata" });
  });
});

describe("crossOriginVerdict under a relaxation admitting missing Fetch Metadata", () => {
  it("allows a mutation that carries no Sec-Fetch-Site", () => {
    expect(crossOriginVerdict(new Request("https://example.com/test", { method: "DELETE" }), true)).toEqual({ ok: true });
  });

  it("still refuses a cross-site or same-site mutation", () => {
    const req = (site: string) => new Request("https://example.com/test", { method: "POST", headers: { "Sec-Fetch-Site": site } });
    expect([crossOriginVerdict(req("cross-site"), true), crossOriginVerdict(req("same-site"), true)]).toEqual([
      { ok: false, error: "cross-site" },
      { ok: false, error: "same-site" },
    ]);
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

  it("returns 403 for DELETE with no Sec-Fetch-Site under a bare router", async () => {
    const routes = createRoutes({ r: new Route("ANY", "/test") });
    const router = createRouter({ middleware: [crossOriginProtection()] });
    router.map(routes.r, () => new Response("ok"));
    const res = await router.fetch(new Request("https://example.com/test", { method: "DELETE" }));
    expect(res.status).toBe(403);
  });

  it("takes no options, so only a development build relaxes it", () => {
    // @ts-expect-error — `crossOriginProtection` takes no `dev` option
    crossOriginProtection({ dev: true });
  });
});

describe("originProtection middleware", () => {
  it("returns 403 for POST with Sec-Fetch-Site: cross-site (regardless of Origin)", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site", Origin: ALLOWED } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("returns 403 for POST with Sec-Fetch-Site: same-site (sibling subdomain)", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-site", Origin: ALLOWED } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("allows POST with Sec-Fetch-Site: same-origin and no Origin/Referer (browser vouched)", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(res.status).toBe(200);
  });

  it("allows POST with Sec-Fetch-Site: none and no Origin/Referer, the other half of the admitted set", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "none" } });
    expect(res.status).toBe(200);
  });

  it("returns 403 for POST with a Sec-Fetch-Site value outside the admitted set and no Origin/Referer", async () => {
    const app = makeOriginApp();
    for (const value of ["same-site", "cross-site", "unknown", ""]) {
      const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": value } });
      expect(res.status).toBe(403);
    }
  });

  it("allows POST with Sec-Fetch-Site: same-origin and an allowed Origin", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin", Origin: ALLOWED } });
    expect(res.status).toBe(200);
  });

  it("returns 403 for POST with Sec-Fetch-Site: same-origin when Origin is disallowed", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin", Origin: "https://evil.example.com" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("returns 403 for a forged Sec-Fetch-Site: same-origin with a disallowed Referer", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin", Referer: "https://evil.example.com/page" },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
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

  it("allows a cross-site safe GET (safe method exempted before the COP check)", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "GET", headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example.com" } });
    expect(res.status).toBe(200);
  });

  it("resolves allowedOrigins from the app context when given a resolver", async () => {
    const app = makeOriginApp({ allowedOrigins: () => [ALLOWED] });
    const allowed = await app.request("/test", { method: "POST", headers: { Origin: ALLOWED } });
    expect(allowed.status).toBe(200);
    const disallowed = await app.request("/test", { method: "POST", headers: { Origin: "https://evil.example.com" } });
    expect(disallowed.status).toBe(403);
  });

  it("passes a same-origin WebSocket upgrade", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "GET", headers: { ...UPGRADE, "Sec-Fetch-Site": "same-origin", Origin: ALLOWED } });
    expect(res.status).toBe(200);
  });

  it("returns 403 for a WebSocket upgrade from a foreign Origin", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "GET", headers: { ...UPGRADE, Origin: "https://evil.example.com" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("returns 403 for a cross-site WebSocket upgrade carrying an allowed Origin", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "GET", headers: { ...UPGRADE, "Sec-Fetch-Site": "cross-site", Origin: ALLOWED } });
    expect(res.status).toBe(403);
  });

  it("returns 403 for a WebSocket upgrade with no Origin, which Fetch Metadata does not vouch for", async () => {
    const app = makeOriginApp();
    const res = await app.request("/test", { method: "GET", headers: { ...UPGRADE, "Sec-Fetch-Site": "same-origin" } });
    expect(res.status).toBe(403);
  });
});

describe("crossOriginProtection on a WebSocket upgrade", () => {
  it("returns 403 for a cross-site upgrade and passes a same-origin one", async () => {
    const app = makeApp();
    const crossSite = await app.request("/test", { method: "GET", headers: { ...UPGRADE, "Sec-Fetch-Site": "cross-site" } });
    expect(crossSite.status).toBe(403);
    const sameOrigin = await app.request("/test", { method: "GET", headers: { ...UPGRADE, "Sec-Fetch-Site": "same-origin" } });
    expect(sameOrigin.status).toBe(200);
  });
});

describe("originProtection and `FORGE_DEV_ORIGINS`", () => {
  it("refuses an origin the binding names, in a build not armed for development", async () => {
    const TUNNEL = "https://tunnel.example";
    const res = await makeOriginApp().request("/test", { method: "POST", headers: { Origin: TUNNEL } }, { FORGE_DEV_ORIGINS: TUNNEL });
    expect(res.status).toBe(403);
  });
});

describe("crossOriginVerdict", () => {
  it("stays off the security barrel, so no consumer reaches the relaxation", () => {
    expect(Object.values<unknown>(securityBarrel).includes(crossOriginVerdict)).toBe(false);
  });
});
