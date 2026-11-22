import { describe, expect, it, spyOn } from "bun:test";

import { createRouter } from "@remix-run/fetch-router";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";

import { createApp } from "../app/app";
import { Forge } from "../app/forge-app";
import { refuseHookCtx } from "../context/refusal";
import type { Refusal } from "../context/types";
import { requestLog } from "../logging/request-logger";
import { captureLogs } from "../testing/logs";
import { mapHandler } from "../testing/route";
import { checkCrossOriginProtection, crossOriginProtection, crossOriginVerdict, originProtection } from "./cop";
import * as securityBarrel from "./mod";
import type { OriginProtectionOptions, OriginRefusal } from "./types";

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

function loggedOriginApp(opts: OriginProtectionOptions) {
  const capture = captureLogs();
  const app = new Forge();
  app.use("*", (context, next) => {
    requestLog.set(context, capture.logger);
    return next();
  });
  app.use("*", originProtection(opts));
  mapHandler(app, "ANY", "/test", () => new Response("ok"));
  return {
    app,
    get warnings() {
      return capture.records.map(({ level, message, data }) => [level, message, data]);
    },
  };
}

const originLine = (reason: OriginRefusal) => [
  "warn",
  "security.origin.refused",
  { source: "security", guard: "origin", status: 403, reason, routePattern: "/test", requestId: null },
];

const REFUSED: { reason: OriginRefusal; init: RequestInit }[] = [
  { reason: "cross-site", init: { method: "POST", headers: { "Sec-Fetch-Site": "cross-site", Origin: ALLOWED } } },
  { reason: "same-site", init: { method: "POST", headers: { "Sec-Fetch-Site": "same-site", Origin: ALLOWED } } },
  { reason: "disallowed", init: { method: "POST", headers: { "Sec-Fetch-Site": "same-origin", Origin: "https://evil.example.com" } } },
  { reason: "missing", init: { method: "POST" } },
  { reason: "missing", init: { method: "GET", headers: { ...UPGRADE, "Sec-Fetch-Site": "same-origin" } } },
];

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

  for (const { reason, init } of REFUSED) {
    it(`hands a ${reason} refusal of ${init.method} to onRefuse as an origin 403 and logs security.origin.refused`, async () => {
      const seen: Refusal[] = [];
      const logged = loggedOriginApp({
        allowedOrigins: [ALLOWED],
        onRefuse: (_c, refusal) => {
          seen.push(refusal);
          return new Response("refused", { status: 418 });
        },
      });
      const res = await logged.app.request("/test", init);
      expect({ status: res.status, body: await res.text(), seen, warnings: logged.warnings }).toEqual({
        status: 418,
        body: "refused",
        seen: [{ guard: "origin", status: 403, reason }],
        warnings: [originLine(reason)],
      });
    });

    it(`answers a ${reason} refusal of ${init.method} with a bare 403 and logs security.origin.refused when no hook is declared`, async () => {
      const logged = loggedOriginApp({ allowedOrigins: [ALLOWED] });
      const res = await logged.app.request("/test", init);
      expect({ status: res.status, body: await res.text(), warnings: logged.warnings }).toEqual({
        status: 403,
        body: "Forbidden",
        warnings: [originLine(reason)],
      });
    });
  }

  it("returns the response an async onRefuse resolves to", async () => {
    const { app } = loggedOriginApp({ allowedOrigins: [ALLOWED], onRefuse: async () => Response.json({ error: "origin" }, { status: 400 }) });
    const res = await app.request("/test", { method: "POST", headers: { Origin: "https://evil.example.com" } });
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 400, body: { error: "origin" } });
  });

  it("hands onRefuse the app context, so it can read the request's bindings", async () => {
    const app = makeOriginApp({ allowedOrigins: [ALLOWED], onRefuse: (c) => new Response(String(c.env.SUPPORT_URL), { status: 403 }) });
    const res = await app.request("/test", { method: "POST" }, { SUPPORT_URL: "https://help.example.com" });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 403, body: "https://help.example.com" });
  });

  it("neither calls onRefuse nor logs on an admitted request", async () => {
    const seen: Refusal[] = [];
    const logged = loggedOriginApp({
      allowedOrigins: [ALLOWED],
      onRefuse: (_c, refusal) => (seen.push(refusal), new Response(null, { status: 418 })),
    });
    const res = await logged.app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin", Origin: ALLOWED } });
    expect({ status: res.status, body: await res.text(), seen, warnings: logged.warnings }).toEqual({
      status: 200,
      body: "ok",
      seen: [],
      warnings: [],
    });
  });

  it("refuses and logs to the console under the security prefix when no request logger is set", async () => {
    const consoleLog = spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await makeOriginApp().request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
      const lines = consoleLog.mock.calls.map(([line]) => {
        const { timestamp: _timestamp, ...rest } = JSON.parse(String(line)) as Record<string, unknown>;
        return rest;
      });
      expect({ status: res.status, body: await res.text(), lines }).toEqual({
        status: 403,
        body: "Forbidden",
        lines: [
          {
            level: "warn",
            prefix: "security",
            message: "security.origin.refused",
            guard: "origin",
            status: 403,
            reason: "cross-site",
            routePattern: "/test",
            requestId: null,
          },
        ],
      });
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("answers through the hook published on the request when it declares none of its own", async () => {
    const seen: Refusal[] = [];
    const app = new Forge();
    app.use("*", (context, next) => {
      refuseHookCtx.set(context, (_c, refusal) => (seen.push(refusal), new Response("chain", { status: 418 })));
      return next();
    });
    app.use("*", originProtection({ allowedOrigins: [ALLOWED] }));
    mapHandler(app, "ANY", "/test", () => new Response("ok"));

    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect({ status: res.status, body: await res.text(), seen }).toEqual({
      status: 418,
      body: "chain",
      seen: [{ guard: "origin", status: 403, reason: "cross-site" }],
    });
  });

  it("answers through its own hook ahead of the one published on the request", async () => {
    const app = new Forge();
    app.use("*", (context, next) => {
      refuseHookCtx.set(context, () => new Response("chain", { status: 418 }));
      return next();
    });
    app.use("*", originProtection({ allowedOrigins: [ALLOWED], onRefuse: () => new Response("own", { status: 409 }) }));
    mapHandler(app, "ANY", "/test", () => new Response("ok"));

    const res = await app.request("/test", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 409, body: "own" });
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

function hookedOriginApp(opts: OriginProtectionOptions) {
  const seen: Refusal[] = [];
  const app = makeOriginApp({ ...opts, onRefuse: (_c, refusal) => (seen.push(refusal), new Response("refused", { status: 418 })) });
  return { app, seen };
}

const ADMITS_SIGNALLESS: OriginProtectionOptions = { allowedOrigins: [ALLOWED], missing: "allow" };

const STILL_REFUSED_UNDER_ALLOW: { name: string; reason: OriginRefusal; init: RequestInit }[] = [
  { name: "a disallowed Origin", reason: "disallowed", init: { method: "POST", headers: { Origin: "https://evil.example.com" } } },
  { name: "a disallowed Referer", reason: "disallowed", init: { method: "POST", headers: { Referer: "https://evil.example.com/page" } } },
  { name: "a cross-site Sec-Fetch-Site", reason: "cross-site", init: { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } } },
  { name: "a same-site Sec-Fetch-Site", reason: "same-site", init: { method: "POST", headers: { "Sec-Fetch-Site": "same-site" } } },
  { name: "a WebSocket upgrade with no signal", reason: "missing", init: { method: "GET", headers: UPGRADE } },
  {
    name: "a WebSocket upgrade vouched only by Sec-Fetch-Site",
    reason: "missing",
    init: { method: "GET", headers: { ...UPGRADE, "Sec-Fetch-Site": "same-origin" } },
  },
];

describe('originProtection with missing: "allow"', () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    it(`admits a ${method} carrying no Origin, Referer or Sec-Fetch-Site without calling onRefuse`, async () => {
      const { app, seen } = hookedOriginApp(ADMITS_SIGNALLESS);
      const res = await app.request("/test", { method });
      expect({ status: res.status, body: await res.text(), seen }).toEqual({ status: 200, body: "ok", seen: [] });
    });
  }

  it("still admits an allowed Origin", async () => {
    const res = await makeOriginApp(ADMITS_SIGNALLESS).request("/test", { method: "POST", headers: { Origin: ALLOWED } });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 200, body: "ok" });
  });

  for (const { name, reason, init } of STILL_REFUSED_UNDER_ALLOW) {
    it(`still hands onRefuse a ${reason} origin 403 for ${name}`, async () => {
      const { app, seen } = hookedOriginApp(ADMITS_SIGNALLESS);
      const res = await app.request("/test", init);
      expect({ status: res.status, seen }).toEqual({ status: 418, seen: [{ guard: "origin", status: 403, reason }] });
    });

    it(`still answers ${name} with a bare 403 when no hook is declared`, async () => {
      const res = await makeOriginApp(ADMITS_SIGNALLESS).request("/test", init);
      expect({ status: res.status, body: await res.text() }).toEqual({ status: 403, body: "Forbidden" });
    });
  }
});

describe("originProtection refuses a signal-less mutation unless missing is allow", () => {
  const REFUSING: { name: string; opts: OriginProtectionOptions }[] = [
    { name: "by default", opts: { allowedOrigins: [ALLOWED] } },
    { name: 'under missing: "refuse"', opts: { allowedOrigins: [ALLOWED], missing: "refuse" } },
  ];

  for (const { name, opts } of REFUSING) {
    it(`hands onRefuse a missing origin 403 for a POST with no signal ${name}`, async () => {
      const { app, seen } = hookedOriginApp(opts);
      const res = await app.request("/test", { method: "POST" });
      expect({ status: res.status, seen }).toEqual({ status: 418, seen: [{ guard: "origin", status: 403, reason: "missing" }] });
    });

    it(`answers a POST with no signal with a bare 403 ${name}`, async () => {
      const res = await makeOriginApp(opts).request("/test", { method: "POST" });
      expect({ status: res.status, body: await res.text() }).toEqual({ status: 403, body: "Forbidden" });
    });
  }
});

describe("crossOriginVerdict", () => {
  it("stays off the security barrel, so no consumer reaches the relaxation", () => {
    expect(Object.values<unknown>(securityBarrel).includes(crossOriginVerdict)).toBe(false);
  });
});
