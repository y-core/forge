import { afterEach, beforeAll, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";
import { createSession } from "@remix-run/session";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { contextVar } from "../context/accessor";
import { refuseHookCtx } from "../context/refusal";
import type { Refusal, RefuseHook } from "../context/types";
import { createKeyRingResolver } from "../crypto/keyring/resolver";
import { importKeyRing } from "../crypto/keyring/ring";
import type { KeyRing, KeyRingResolver } from "../crypto/keyring/types";
import { createCsrfToken, csrfMintStage, mintCsrf, verifyCsrfToken } from "../form/csrf";
import { consoleChannel } from "../logging/channels";
import type { LogRecord } from "../logging/types";
import { jsx } from "../render/jsx/jsx-runtime";
import { cors } from "../security/cors";
import { getNonce } from "../security/headers";
import { NONCE } from "../security/nonce";
import { rateLimit, routeKeySuffix } from "../security/rate-limit";
import { defaultRefusalResponse } from "../security/refusal";
import { cfHeadersTrustedCtx, requestIdCtx } from "../security/request-id";
import type { RateLimit, RateLimitOptions } from "../security/types";
import { createSignedCookie } from "../session/cookie";
import { brandSessionMiddleware, sessionCtx, sessionMiddleware } from "../session/session";
import type { SessionMiddleware } from "../session/types";
import { mapHandler } from "../testing/route";
import { ANNOUNCE_FAILURE_ATTR } from "../ui/contracts/announcer-contract";
import { v } from "../validation/mod";
import { Forge } from "./forge-app";
import { applyMiddlewareChain, buildGuardChain } from "./middleware-chain";
import * as appBarrel from "./mod";
import { refuseAsFragment, refuseAsProblem } from "./refusal";
import type { MiddlewareChainOptions, MiddlewareContribution, MiddlewareGuardGroup } from "./types";

/** Declares the optional `LIMITER` binding the rate limits here name, and its window. */
const DECLARES_LIMITER = {
  bindings: v.object({ LIMITER: v.optional(v.unknown()), RATE_LIMITER: v.optional(v.unknown()) }),
  rateLimits: { LIMITER: { limit: 10, period: 60 }, RATE_LIMITER: { limit: 10, period: 60 } },
};

/** A chain `session` slot that puts a stub session on `sessionCtx`, then runs `inner`. */
function sessionSlot(inner: Middleware = (_context, next) => next()): SessionMiddleware {
  return brandSessionMiddleware((context, next) => {
    sessionCtx.set(context, createSession("chain-test-session"));
    return inner(context, next);
  }, undefined);
}

/** Publishes trust in the CF headers, as a chain declaring it does. */
const trustingCf: Middleware = (context, next) => {
  cfHeadersTrustedCtx.set(context, true);
  return next();
};

function probe(label: string, order: string[]): Middleware {
  return async (_context, next) => {
    order.push(label);
    return next();
  };
}

describe("applyMiddlewareChain — canonical order", () => {
  it("runs logging → session → per-path guard → handler, with requestId and nonce set before session", async () => {
    const order: string[] = [];
    let requestIdWasSet = false;
    let nonceWasSet = false;

    const app = new Forge();
    applyMiddlewareChain(app, {
      logging: {
        channels: () => [],
        bindings: (c) => {
          order.push("logging");
          return { requestId: requestIdCtx.getOptional(c) ?? "" };
        },
      },
      securityHeaders: {},
      session: sessionSlot(async (context, next) => {
        order.push("session");
        requestIdWasSet = requestIdCtx.getOptional(context) !== undefined;
        nonceWasSet = getNonce(context) !== "";
        return next();
      }),
      guards: [{ paths: ["/guarded"], guards: [probe("guard", order)] }],
    });
    mapHandler(app, "GET", "/guarded", () => {
      order.push("handler");
      return new Response("ok");
    });

    const res = await app.request("/guarded");
    expect(res.status).toBe(200);
    expect(order).toEqual(["logging", "session", "guard", "handler"]);
    expect(requestIdWasSet).toBe(true);
    expect(nonceWasSet).toBe(true);
  });

  it("skips per-path guards on non-matching paths", async () => {
    const order: string[] = [];
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      session: sessionSlot(probe("session", order)),
      guards: [{ paths: ["/guarded"], guards: [probe("guard", order)] }],
    });
    mapHandler(app, "GET", "/open", () => {
      order.push("handler");
      return new Response("ok");
    });

    await app.request("/open");
    expect(order).toEqual(["session", "handler"]);
  });

  it("omits requestId when requestId is false", async () => {
    let requestIdWasSet: boolean | undefined;
    const app = new Forge();
    applyMiddlewareChain(app, {
      requestId: false,
      securityHeaders: {},
      session: sessionSlot(async (context, next) => {
        requestIdWasSet = requestIdCtx.getOptional(context) !== undefined;
        return next();
      }),
    });
    mapHandler(app, "GET", "/", () => new Response("ok"));

    await app.request("/");
    expect(requestIdWasSet).toBe(false);
  });

  it("applies security headers to the response", async () => {
    const app = new Forge();
    applyMiddlewareChain(app, { securityHeaders: {} });
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("enforces validateBindings before handlers run", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    let handlerReached = false;
    applyMiddlewareChain(app, { securityHeaders: {}, bindings: v.object({ REQUIRED_SECRET: v.string() }) });
    mapHandler(app, "GET", "/", () => {
      handlerReached = true;
      return new Response("ok");
    });

    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
    expect(handlerReached).toBe(false);
  });

  it("wires origin guards onto guarded paths (cross-origin POST → 403 Forbidden)", async () => {
    const app = new Forge();
    applyMiddlewareChain(app, { securityHeaders: {}, guards: [{ paths: ["/api/save"], origin: { allowedOrigins: ["https://example.com"] } }] });
    mapHandler(app, "POST", "/api/save", () => new Response("saved"));

    const rejected = await app.request("/api/save", { method: "POST", headers: { origin: "https://evil.example.net" } });
    expect(rejected.status).toBe(403);
    expect(await rejected.text()).toBe("Forbidden");

    const allowed = await app.request("/api/save", { method: "POST", headers: { origin: "https://example.com" } });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("saved");
  });

  it('admits a signal-less POST only on the paths of a guard group whose origin check sets missing: "allow"', async () => {
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      guards: [
        { paths: ["/mcp"], origin: { allowedOrigins: ["https://example.com"], missing: "allow" } },
        { paths: ["/api/save"], origin: { allowedOrigins: ["https://example.com"] } },
      ],
    });
    mapHandler(app, "POST", "/mcp", () => new Response("tool"));
    mapHandler(app, "POST", "/api/save", () => new Response("saved"));

    const mcp = await app.request("/mcp", { method: "POST" });
    const save = await app.request("/api/save", { method: "POST" });
    expect([
      { status: mcp.status, body: await mcp.text() },
      { status: save.status, body: await save.text() },
    ]).toEqual([
      { status: 200, body: "tool" },
      { status: 403, body: "Forbidden" },
    ]);
  });

  it("wires rate limiting onto guarded paths (over limit → 429) when trustCfHeaders is set", async () => {
    const app = new Forge<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>();
    applyMiddlewareChain(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      trustCfHeaders: true,
      guards: [{ paths: ["/api/save"], rateLimit: { binding: "LIMITER" } }],
    });
    mapHandler(app, "POST", "/api/save", () => new Response("saved"));

    const res = await app.request(
      "/api/save",
      { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.7" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("Too many requests. Please try again later.");
  });

  it("keys a guard group's keySuffix as `<ip>:<suffix>` under the chain's trustCfHeaders", async () => {
    let capturedKey: string | undefined;
    const app = new Forge<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>();
    applyMiddlewareChain(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      trustCfHeaders: true,
      guards: [{ paths: ["/api/save"], rateLimit: { binding: "LIMITER", keySuffix: (c) => new URL(c.request.url).pathname } }],
    });
    mapHandler(app, "POST", "/api/save", () => new Response("saved"));

    const res = await app.request(
      "/api/save",
      { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.7" } },
      {
        LIMITER: {
          limit: async ({ key }) => {
            capturedKey = key;
            return { success: true };
          },
        },
      },
    );
    expect({ status: res.status, body: await res.text(), capturedKey }).toEqual({
      status: 200,
      body: "saved",
      capturedKey: "203.0.113.7:/api/save",
    });
  });

  it("refuses a guard group's keySuffix at registration when the chain does not trust CF headers", () => {
    const app = new Forge<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>();
    expect(() =>
      applyMiddlewareChain(app, {
        ...DECLARES_LIMITER,
        securityHeaders: {},
        guards: [{ paths: ["/api/save"], rateLimit: { binding: "LIMITER", keySuffix: () => "route" } }],
      }),
    ).toThrow(
      "guard group `/api/save`: its `rateLimit` keys by client IP, which needs `trustCfHeaders: true` on `applyMiddlewareChain`, or a custom `key`.",
    );
  });

  it("registers a guard group once for overlapping paths", async () => {
    const order: string[] = [];
    let limitCalls = 0;
    const app = new Forge<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>();
    applyMiddlewareChain(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      trustCfHeaders: true,
      guards: [{ paths: ["/api/*", "/api/users"], rateLimit: { binding: "LIMITER" }, guards: [probe("guard", order)] }],
    });
    mapHandler(app, "GET", "/api/users", () => new Response("ok"));

    const res = await app.request(
      "/api/users",
      { headers: { "CF-Connecting-IP": "203.0.113.7" } },
      {
        LIMITER: {
          limit: async () => {
            limitCalls += 1;
            return { success: true };
          },
        },
      },
    );
    expect(res.status).toBe(200);
    expect(limitCalls).toBe(1);
    expect(order).toEqual(["guard"]);
  });

  it("fires a multi-path group on every path it names and on none it does not", async () => {
    const order: string[] = [];
    const app = new Forge();
    applyMiddlewareChain(app, { securityHeaders: {}, guards: [{ paths: ["/api/*", "/admin/settings"], guards: [probe("guard", order)] }] });
    mapHandler(app, "GET", "/api/users", () => new Response("ok"));
    mapHandler(app, "GET", "/admin/settings", () => new Response("ok"));
    mapHandler(app, "GET", "/public", () => new Response("ok"));

    await app.request("/api/users");
    await app.request("/admin/settings");
    await app.request("/public");
    expect(order).toEqual(["guard", "guard"]);
  });

  it("registers nothing for a group with no paths", async () => {
    const order: string[] = [];
    const app = new Forge();
    applyMiddlewareChain(app, { securityHeaders: {}, guards: [{ paths: [], guards: [probe("guard", order)] }] });
    mapHandler(app, "GET", "/anything", () => new Response("ok"));

    const res = await app.request("/anything");
    expect(res.status).toBe(200);
    expect(order).toEqual([]);
  });

  it("threads default-distrust to rate-limit guards, refusing a keyless group at registration and registering nothing", async () => {
    const app = new Forge<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>();
    expect(() =>
      applyMiddlewareChain(app, {
        ...DECLARES_LIMITER,
        securityHeaders: {},
        guards: [{ paths: ["/api/save"], rateLimit: { binding: "LIMITER" } }],
      }),
    ).toThrow(
      "guard group `/api/save`: its `rateLimit` keys by client IP, which needs `trustCfHeaders: true` on `applyMiddlewareChain`, or a custom `key`.",
    );
    mapHandler(app, "POST", "/api/save", () => new Response("saved"));

    const res = await app.request("/api/save", { method: "POST" });
    expect({ status: res.status, nosniff: res.headers.get("x-content-type-options") }).toEqual({ status: 200, nosniff: null });
  });

  it("threads trustCfHeaders to requestId (adopts CF-Ray)", async () => {
    let capturedId: string | undefined;
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      trustCfHeaders: true,
      session: sessionSlot(async (context, next) => {
        capturedId = requestIdCtx.getOptional(context);
        return next();
      }),
    });
    mapHandler(app, "GET", "/", () => new Response("ok"));

    await app.request("/", { headers: { "CF-Ray": "ray-abc-IAD" } });
    expect(capturedId).toBe("ray-abc-IAD");
  });

  it("runs `before` ahead of requestId, and `globals` after session and before the first guard group", async () => {
    const order: string[] = [];
    let requestIdAtBefore: string | undefined;
    const app = new Forge();
    applyMiddlewareChain(app, {
      before: [
        async (context, next) => {
          order.push("before");
          requestIdAtBefore = requestIdCtx.getOptional(context);
          return next();
        },
      ],
      securityHeaders: {},
      session: sessionSlot(probe("session", order)),
      globals: [probe("global", order)],
      guards: [{ paths: ["/guarded"], guards: [probe("guard", order)] }],
    });
    mapHandler(app, "GET", "/guarded", () => {
      order.push("handler");
      return new Response("ok");
    });

    const res = await app.request("/guarded");
    expect(res.status).toBe(200);
    expect(order).toEqual(["before", "session", "global", "guard", "handler"]);
    expect(requestIdAtBefore).toBe(undefined);
  });

  it("registers no `before` or `globals` middleware when neither is given", async () => {
    const order: string[] = [];
    const app = new Forge();
    applyMiddlewareChain(app, { securityHeaders: {}, session: sessionSlot(probe("session", order)) });
    mapHandler(app, "GET", "/", () => {
      order.push("handler");
      return new Response("ok");
    });

    await app.request("/");
    expect(order).toEqual(["session", "handler"]);
  });

  it("ignores a spoofed CF-Ray by default in requestId", async () => {
    let capturedId: string | undefined;
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      session: sessionSlot(async (context, next) => {
        capturedId = requestIdCtx.getOptional(context);
        return next();
      }),
    });
    mapHandler(app, "GET", "/", () => new Response("ok"));

    await app.request("/", { headers: { "CF-Ray": "ray-abc-IAD" } });
    expect(capturedId).not.toBe("ray-abc-IAD");
    expect(capturedId).not.toBe(undefined);
  });
});

describe("applyMiddlewareChain — contributions", () => {
  it("joins contributed globals after the options' own and contributed guards after the options' guards, in array order", async () => {
    const order: string[] = [];
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      session: sessionSlot(probe("session", order)),
      globals: [probe("global", order)],
      guards: [{ paths: ["/guarded"], guards: [probe("guard", order)] }],
      contributions: [
        { globals: [probe("first-global", order)], guards: [{ paths: ["/guarded"], guards: [probe("first-guard", order)] }] },
        { globals: [probe("second-global", order)] },
      ],
    });
    mapHandler(app, "GET", "/guarded", () => {
      order.push("handler");
      return new Response("ok");
    });

    await app.request("/guarded");
    expect(order).toEqual(["session", "global", "first-global", "second-global", "guard", "first-guard", "handler"]);
  });

  it("registers a contributed session when the options supply none", async () => {
    const order: string[] = [];
    const app = new Forge();
    applyMiddlewareChain(app, { securityHeaders: {}, contributions: [{ session: sessionSlot(probe("session", order)) }] });
    mapHandler(app, "GET", "/", () => new Response("ok"));

    await app.request("/");
    expect(order).toEqual(["session"]);
  });

  it("refuses a second session, whether contributed or the options' own", () => {
    const pass = sessionSlot();
    const message = "applyMiddlewareChain: two sources each supply a session, and the chain takes one.";
    expect(() => applyMiddlewareChain(new Forge(), { securityHeaders: {}, contributions: [{ session: pass }, { session: pass }] })).toThrow(
      message,
    );
    expect(() => applyMiddlewareChain(new Forge(), { securityHeaders: {}, session: pass, contributions: [{ session: pass }] })).toThrow(message);
  });

  it("validates contributed bindings before handlers run", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    applyMiddlewareChain(app, {
      securityHeaders: {},
      contributions: [{ bindings: [{ name: "DB", methods: ["prepare"], label: "a D1 binding" }] }],
    });
    mapHandler(app, "GET", "/", () => new Response("ok"));

    expect((await app.request("/", {}, {})).status).toBe(500);
    expect((await app.request("/", {}, { DB: { prepare: () => null } })).status).toBe(200);
  });

  it("refuses a binding name contributed twice", () => {
    const spec = { name: "DB", methods: ["prepare"], label: "a D1 binding" };
    expect(() => applyMiddlewareChain(new Forge(), { securityHeaders: {}, contributions: [{ bindings: [spec] }, { bindings: [spec] }] })).toThrow(
      'applyMiddlewareChain: the binding "DB" is contributed twice.',
    );
  });

  describe("a refused chain registers nothing", () => {
    const DB = { name: "DB", methods: ["prepare"], label: "a D1 binding" };
    const refusals: { name: string; session?: boolean; contributions: { session?: boolean; bindings?: (typeof DB)[] }[] }[] = [
      { name: "two contributed sessions", contributions: [{ session: true, bindings: [DB] }, { session: true }] },
      { name: "the options' session and a contributed one", session: true, contributions: [{ session: true, bindings: [DB] }] },
      { name: "a binding name contributed twice", contributions: [{ bindings: [DB] }, { bindings: [DB] }] },
    ];

    for (const refusal of refusals) {
      it(`on ${refusal.name}`, async () => {
        const order: string[] = [];
        const app = new Forge();
        app.setOnError((err) => new Response(err.message, { status: 500 }));
        expect(() =>
          applyMiddlewareChain(app, {
            before: [probe("before", order)],
            securityHeaders: {},
            ...(refusal.session ? { session: sessionSlot(probe("options-session", order)) } : {}),
            globals: [probe("global", order)],
            guards: [{ paths: ["/"], guards: [probe("guard", order)] }],
            contributions: refusal.contributions.map((contribution) => ({
              ...(contribution.session ? { session: sessionSlot(probe("contributed-session", order)) } : {}),
              ...(contribution.bindings ? { bindings: contribution.bindings } : {}),
              globals: [probe("contributed-global", order)],
            })),
          }),
        ).toThrow(/^applyMiddlewareChain: /);
        mapHandler(app, "GET", "/", () => {
          order.push("handler");
          return new Response("ok");
        });

        const res = await app.request("/", {}, {});
        expect({ status: res.status, body: await res.text(), nosniff: res.headers.get("x-content-type-options"), order }).toEqual({
          status: 200,
          body: "ok",
          nosniff: null,
          order: ["handler"],
        });
      });
    }
  });

  describe("contributed bindings", () => {
    const outcomes: { name: string; optional: boolean; env: Record<string, unknown>; status: number; body: string }[] = [
      { name: "refuses a missing required binding", optional: false, env: {}, status: 500, body: "Invalid environment: DB: missing" },
      { name: "passes an absent optional binding", optional: true, env: {}, status: 200, body: "ok" },
      {
        name: "refuses an optional binding present with the wrong shape",
        optional: true,
        env: { DB: { exec: () => null } },
        status: 500,
        body: "Invalid environment: DB: DB must be a D1 binding",
      },
      {
        name: "refuses a required binding present with the wrong shape",
        optional: false,
        env: { DB: {} },
        status: 500,
        body: "Invalid environment: DB: DB must be a D1 binding",
      },
      {
        name: "passes an optional binding present with the right shape",
        optional: true,
        env: { DB: { prepare: () => null } },
        status: 200,
        body: "ok",
      },
    ];

    for (const { name, optional, env, status, body } of outcomes) {
      it(name, async () => {
        let handled = false;
        const app = new Forge();
        app.setOnError((err) => new Response(err.message, { status: 500 }));
        applyMiddlewareChain(app, {
          securityHeaders: {},
          contributions: [{ bindings: [{ name: "DB", methods: ["prepare"], label: "a D1 binding", optional }] }],
        });
        mapHandler(app, "GET", "/", () => {
          handled = true;
          return new Response("ok");
        });

        const res = await app.request("/", {}, env);
        expect({ status: res.status, body: await res.text(), handled }).toEqual({ status, body, handled: status === 200 });
      });
    }

    it("enforces the options' own bindings and the contributed ones, each on its own", async () => {
      const app = new Forge();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      applyMiddlewareChain(app, {
        securityHeaders: {},
        bindings: v.object({ KV: v.object({ get: v.function() }) }),
        contributions: [{ bindings: [{ name: "DB", methods: ["prepare"], label: "a D1 binding" }] }],
      });
      mapHandler(app, "GET", "/", () => new Response("ok"));

      const answer = async (env: Record<string, unknown>) => {
        const res = await app.request("/", {}, env);
        return [res.status, await res.text()];
      };
      const kv = { get: () => null };
      const db = { prepare: () => null };
      expect(await answer({ DB: db })).toEqual([500, "Invalid environment: KV: missing"]);
      expect(await answer({ KV: kv })).toEqual([500, "Invalid environment: DB: missing"]);
      expect(await answer({ KV: kv, DB: db })).toEqual([200, "ok"]);
    });

    it("merges bindings from several contributions into one check", async () => {
      const app = new Forge();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      applyMiddlewareChain(app, {
        securityHeaders: {},
        contributions: [
          { bindings: [{ name: "DB", methods: ["prepare"], label: "a D1 binding" }] },
          { bindings: [{ name: "KV", methods: ["get"], label: "a KV binding" }] },
        ],
      });
      mapHandler(app, "GET", "/", () => new Response("ok"));

      const res = await app.request("/", {}, { DB: { prepare: () => null } });
      expect([res.status, await res.text()]).toEqual([500, "Invalid environment: KV: missing"]);
      expect((await app.request("/", {}, { DB: { prepare: () => null }, KV: { get: () => null } })).status).toBe(200);
    });
  });

  it("treats a contribution that supplies nothing as no contribution at all", async () => {
    const run = async (contributions?: { session?: SessionMiddleware }[]) => {
      const order: string[] = [];
      const app = new Forge();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      applyMiddlewareChain(app, {
        securityHeaders: {},
        session: sessionSlot(probe("session", order)),
        globals: [probe("global", order)],
        guards: [{ paths: ["/guarded"], guards: [probe("guard", order)] }],
        ...(contributions ? { contributions } : {}),
      });
      mapHandler(app, "GET", "/guarded", () => {
        order.push("handler");
        return new Response("ok");
      });
      const res = await app.request("/guarded", {}, {});
      return { status: res.status, body: await res.text(), order };
    };

    const expected = { status: 200, body: "ok", order: ["session", "global", "guard", "handler"] };
    expect(await run()).toEqual(expected);
    expect(await run([{}])).toEqual(expected);
    expect(await run([{}, {}])).toEqual(expected);
  });
});

describe("buildGuardChain", () => {
  /** Runs `chain` on one request through a bare app, collecting what each element contributes. */
  async function runChain(chain: Middleware[], init?: RequestInit, env?: object): Promise<Response> {
    const app = new Forge();
    app.use("*", ...chain);
    mapHandler(app, "POST", "/guarded", () => new Response("handled"));
    return app.request("/guarded", { method: "POST", ...init }, env as never);
  }

  it("orders the chain origin → rateLimit → csrf verify → guards", async () => {
    const order: string[] = [];
    const chain = buildGuardChain<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>({
      paths: ["/guarded"],
      origin: { allowedOrigins: ["https://example.com"] },
      rateLimit: { binding: "LIMITER" },
      guards: [probe("guard", order)],
    });

    expect(chain).toHaveLength(4);
    const rejected = await runChain(chain as Middleware[], { headers: { origin: "https://evil.example.net" } });
    expect(rejected.status).toBe(403);
    expect(order).toEqual([]);
  });

  it("omits each absent part, leaving an empty chain for a policy-less group", () => {
    const order: string[] = [];
    expect(buildGuardChain({ paths: ["/x"] })).toEqual([]);
    expect(buildGuardChain({ paths: ["/x"], guards: [probe("guard", order)] })).toHaveLength(2);
    expect(buildGuardChain({ paths: ["/x"], origin: { allowedOrigins: ["https://example.com"] } })).toHaveLength(2);
    expect(buildGuardChain({ paths: ["/x"], rateLimit: { binding: "LIMITER", key: () => "k" } })).toHaveLength(2);
    expect(buildGuardChain({ paths: ["/x"], shape: [probe("shape", order)] })).toHaveLength(1);
  });

  it("keys its rate limit under the trust published on the request, answering 503 where none is", async () => {
    const chain = buildGuardChain({ paths: ["/guarded"], rateLimit: { binding: "LIMITER" } });
    const env = { LIMITER: { limit: async () => ({ success: true }) } };
    const headers = { "CF-Connecting-IP": "203.0.113.7" };

    const statuses = [(await runChain([trustingCf, ...chain], { headers }, env)).status, (await runChain(chain, { headers }, env)).status];
    expect(statuses).toEqual([200, 503]);
  });

  it("keeps key and keySuffix exclusive at the type level, and takes a rate limit typed as RateLimitOptions", () => {
    const binding = "LIMITER";
    const policy: RateLimitOptions = { binding };
    const groups: MiddlewareGuardGroup[] = [
      // @ts-expect-error -- a group's rate limit takes key or keySuffix, never both
      { paths: ["/x"], rateLimit: { binding, key: () => "k", keySuffix: () => "s" } },
      { paths: ["/x"], rateLimit: { binding, key: () => "k" } },
      { paths: ["/x"], rateLimit: { binding, keySuffix: () => "s" } },
      { paths: ["/x"], rateLimit: policy },
    ];
    expect(groups).toHaveLength(4);
  });

  it("names the group on the rate limit's own refusal", () => {
    const group = { paths: ["/guarded"], rateLimit: { binding: "LIMITER", key: () => "k", keySuffix: () => "s" } };

    expect(() => buildGuardChain(group as never)).toThrow(
      "guard group `/guarded`: rateLimit: `key` and `keySuffix` are exclusive. Pass `keySuffix` to extend the client-IP key, or `key` to replace it.",
    );
  });
});

describe("applyMiddlewareChain — a guard group keyed per route by routeKeySuffix", () => {
  type Env = { LIMITER: RateLimit };

  function routeKeyedApp() {
    const records: LogRecord[] = [];
    const app = new Forge<Env>();
    applyMiddlewareChain(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      trustCfHeaders: true,
      logging: { channels: () => [{ write: (r) => void records.push(r) }] },
      guards: [{ paths: ["/admin/*"], rateLimit: { binding: "LIMITER", keySuffix: routeKeySuffix } }],
    });
    mapHandler(app, "GET", "/admin/users/:id", () => new Response("user"));
    mapHandler(app, "GET", "/admin/settings", () => new Response("settings"));
    return { app, records };
  }

  function recordingLimiter(keys: string[], success = true): RateLimit {
    return {
      limit: async ({ key }) => {
        keys.push(key);
        return { success };
      },
    };
  }

  async function keysFor(paths: string[]): Promise<{ statuses: number[]; keys: string[] }> {
    const { app } = routeKeyedApp();
    const keys: string[] = [];
    const statuses: number[] = [];
    for (const path of paths) {
      const res = await app.request(path, { headers: { "CF-Connecting-IP": "203.0.113.7" } }, { LIMITER: recordingLimiter(keys) });
      statuses.push(res.status);
    }
    return { statuses, keys };
  }

  it("puts two URLs of one param route in the bucket `<ip>:<pattern>`", async () => {
    expect(await keysFor(["/admin/users/1", "/admin/users/2"])).toStrictEqual({
      statuses: [200, 200],
      keys: ["203.0.113.7:/admin/users/:id", "203.0.113.7:/admin/users/:id"],
    });
  });

  it("gives two distinct routes distinct buckets", async () => {
    expect(await keysFor(["/admin/users/1", "/admin/settings"])).toStrictEqual({
      statuses: [200, 200],
      keys: ["203.0.113.7:/admin/users/:id", "203.0.113.7:/admin/settings"],
    });
  });

  it("puts two unmatched URLs in the one bucket `<ip>:<unmatched>`", async () => {
    expect(await keysFor(["/admin/nope", "/admin/users/1/extra"])).toStrictEqual({
      statuses: [404, 404],
      keys: ["203.0.113.7:<unmatched>", "203.0.113.7:<unmatched>"],
    });
  });

  it("logs the refusal and the completed request with the route pattern, never the client address or the key, on a 429", async () => {
    const { app, records } = routeKeyedApp();
    const keys: string[] = [];

    const res = await app.request("/admin/users/1", { headers: { "CF-Connecting-IP": "203.0.113.7" } }, { LIMITER: recordingLimiter(keys, false) });
    const requestId = res.headers.get("x-request-id");

    expect({
      status: res.status,
      body: await res.text(),
      keys,
      requestIdSent: requestId !== null,
      log: records.map((r) => {
        const { duration: _duration, ...data } = r.data ?? {};
        return { level: r.level, message: r.message, data };
      }),
    }).toStrictEqual({
      status: 429,
      body: "Too many requests. Please try again later.",
      keys: ["203.0.113.7:/admin/users/:id"],
      requestIdSent: true,
      log: [
        {
          level: "warn",
          message: "security.rate-limit.refused",
          data: { source: "security", guard: "rate-limit", status: 429, reason: null, routePattern: "/admin/users/:id", requestId },
        },
        {
          level: "warn",
          message: "request.completed",
          data: { method: "GET", path: "/admin/users/1", routePattern: "/admin/users/:id", status: 429 },
        },
      ],
    });
  });
});

describe("applyMiddlewareChain — a rate limit naming its binding", () => {
  type Env = { LIMITER?: RateLimit; RATE_LIMITER?: RateLimit };
  const CLIENT = { headers: { "CF-Connecting-IP": "203.0.113.7" } };

  function counting(name: string, spent: string[], success = true): RateLimit {
    return {
      limit: async () => {
        spent.push(name);
        return { success };
      },
    };
  }

  function registrationError(options: MiddlewareChainOptions<Env>): string {
    try {
      applyMiddlewareChain(new Forge<Env>(), options);
    } catch (error) {
      return (error as Error).message;
    }
    return "registered";
  }

  it("answers an absent optional binding 503 binding-absent on its group's paths only, while other paths serve", async () => {
    const records: LogRecord[] = [];
    const seen: Refusal[] = [];
    const app = new Forge<Env>();
    applyMiddlewareChain(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      trustCfHeaders: true,
      logging: { channels: () => [{ write: (r) => void records.push(r) }] },
      onRefuse: (_context, refusal) => {
        seen.push(refusal);
        return defaultRefusalResponse(refusal);
      },
      guards: [{ paths: ["/api/*"], rateLimit: { binding: "LIMITER" } }],
    });
    mapHandler(app, "GET", "/api/users", () => new Response("users"));
    mapHandler(app, "GET", "/public", () => new Response("public"));
    const answer = async (path: string) => {
      const res = await app.request(path, CLIENT, {});
      return { status: res.status, body: await res.text() };
    };

    expect({
      api: await answer("/api/users"),
      other: await answer("/public"),
      seen,
      refusals: records.filter((r) => r.message === "security.rate-limit.refused").map((r) => ({ level: r.level, reason: r.data?.["reason"] })),
    }).toEqual({
      api: { status: 503, body: "Service Unavailable" },
      other: { status: 200, body: "public" },
      seen: [{ guard: "rate-limit", status: 503, reason: "binding-absent" }],
      refusals: [{ level: "error", reason: "binding-absent" }],
    });
  });

  const requiredDeclarations: { name: string; declare: Pick<MiddlewareChainOptions<Env>, "bindings" | "contributions"> }[] = [
    { name: "the bindings schema", declare: { bindings: v.object({ LIMITER: v.object({ limit: v.function() }) }) } },
    {
      name: "a contribution's BindingSpec",
      declare: { contributions: [{ bindings: [{ name: "LIMITER", methods: ["limit"], label: "a rate-limit binding" }] }] },
    },
  ];

  for (const { name, declare } of requiredDeclarations) {
    it(`fails validateBindings on every path when the binding is required by ${name} and absent`, async () => {
      const spent: string[] = [];
      const app = new Forge<Env>();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      applyMiddlewareChain(app, {
        ...declare,
        rateLimits: DECLARES_LIMITER.rateLimits,
        securityHeaders: {},
        trustCfHeaders: true,
        guards: [{ paths: ["/api/*"], rateLimit: { binding: "LIMITER" } }],
      });
      mapHandler(app, "GET", "/api/users", () => new Response("users"));
      mapHandler(app, "GET", "/public", () => new Response("public"));
      const answer = async (path: string, env: Env) => {
        const res = await app.request(path, CLIENT, env);
        return { status: res.status, body: await res.text() };
      };

      expect({
        absentGuarded: await answer("/api/users", {}),
        absentOther: await answer("/public", {}),
        present: await answer("/api/users", { LIMITER: counting("LIMITER", spent) }),
        spent,
      }).toEqual({
        absentGuarded: { status: 500, body: "Invalid environment: LIMITER: missing" },
        absentOther: { status: 500, body: "Invalid environment: LIMITER: missing" },
        present: { status: 200, body: "users" },
        spent: ["LIMITER"],
      });
    });
  }

  it("refuses at registration a group naming a misspelt binding, naming the group and the binding, and registers nothing", async () => {
    const app = new Forge<Env>();
    let message = "registered";
    try {
      applyMiddlewareChain(app, {
        ...DECLARES_LIMITER,
        securityHeaders: {},
        trustCfHeaders: true,
        guards: [{ paths: ["/api/save"], rateLimit: { binding: "LIMTER" } }],
      });
    } catch (error) {
      message = (error as Error).message;
    }
    mapHandler(app, "POST", "/api/save", () => new Response("saved"));
    const res = await app.request("/api/save", { method: "POST", ...CLIENT }, {});

    expect(message).toStartWith('guard group `/api/save`: its `rateLimit` names the binding "LIMTER"');
    expect(message).toContain("`bindings` schema");
    expect({ status: res.status, nosniff: res.headers.get("x-content-type-options") }).toEqual({ status: 200, nosniff: null });
  });

  const undeclaredWindows: { name: string; rateLimits: MiddlewareChainOptions<Env>["rateLimits"] }[] = [
    { name: "no rateLimits at all", rateLimits: undefined },
    { name: "rateLimits without its key", rateLimits: { RATE_LIMITER: { limit: 10, period: 60 } } },
  ];

  for (const { name, rateLimits } of undeclaredWindows) {
    it(`refuses at registration a declared binding under ${name}, naming the group, the binding and rateLimits`, () => {
      const message = registrationError({
        bindings: DECLARES_LIMITER.bindings,
        ...(rateLimits ? { rateLimits } : {}),
        securityHeaders: {},
        trustCfHeaders: true,
        guards: [{ paths: ["/api/save"], rateLimit: { binding: "LIMITER" } }],
      });

      expect(message).toStartWith('guard group `/api/save`: its `rateLimit` names the binding "LIMITER"');
      expect(message).toContain("`rateLimits`");
    });
  }

  it("refuses at registration a bindings schema with no object entries to find the binding in, asking for a BindingSpec", () => {
    const message = registrationError({
      bindings: v.union([v.object({ LIMITER: v.optional(v.unknown()) }), v.object({ RATE_LIMITER: v.optional(v.unknown()) })]),
      rateLimits: DECLARES_LIMITER.rateLimits,
      securityHeaders: {},
      trustCfHeaders: true,
      guards: [{ paths: ["/api/save"], rateLimit: { binding: "LIMITER" } }],
    });

    expect(message).toStartWith("guard group `/api/save`:");
    expect(message).toContain("BindingSpec");
  });

  const stacked: { name: string; success: { LIMITER: boolean; RATE_LIMITER: boolean }; expected: { status: number; spent: string[] } }[] = [
    {
      name: "spends both of two stacked limits, in order, and serves",
      success: { LIMITER: true, RATE_LIMITER: true },
      expected: { status: 200, spent: ["LIMITER", "RATE_LIMITER"] },
    },
    {
      name: "refuses 429 on the second stacked limit after the first has spent",
      success: { LIMITER: true, RATE_LIMITER: false },
      expected: { status: 429, spent: ["LIMITER", "RATE_LIMITER"] },
    },
    {
      name: "refuses 429 on the first stacked limit without reaching the second",
      success: { LIMITER: false, RATE_LIMITER: true },
      expected: { status: 429, spent: ["LIMITER"] },
    },
  ];

  for (const { name, success, expected } of stacked) {
    it(name, async () => {
      const spent: string[] = [];
      const app = new Forge<Env>();
      applyMiddlewareChain(app, {
        ...DECLARES_LIMITER,
        securityHeaders: {},
        trustCfHeaders: true,
        logging: { channels: () => [] },
        guards: [{ paths: ["/api/*"], rateLimit: [{ binding: "LIMITER" }, { binding: "RATE_LIMITER" }] }],
      });
      mapHandler(app, "GET", "/api/users", () => new Response("users"));

      const res = await app.request("/api/users", CLIENT, {
        LIMITER: counting("LIMITER", spent, success.LIMITER),
        RATE_LIMITER: counting("RATE_LIMITER", spent, success.RATE_LIMITER),
      });
      expect({ status: res.status, spent }).toEqual(expected);
    });
  }

  const routeLevel: {
    name: string;
    rateLimits: NonNullable<MiddlewareChainOptions<Env>["rateLimits"]>;
    expected: { status: number; spent: string[] };
  }[] = [
    {
      name: "serves a route-level rateLimit whose binding the chain's rateLimits holds",
      rateLimits: DECLARES_LIMITER.rateLimits,
      expected: { status: 200, spent: ["LIMITER"] },
    },
    {
      name: "throws on the request, through onError, for a route-level rateLimit the chain's rateLimits lacks",
      rateLimits: { RATE_LIMITER: { limit: 10, period: 60 } },
      expected: { status: 500, spent: [] },
    },
  ];

  for (const { name, rateLimits, expected } of routeLevel) {
    it(name, async () => {
      const spent: string[] = [];
      const app = new Forge<Env>();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      applyMiddlewareChain(app, { securityHeaders: {}, rateLimits });
      app.use("*", rateLimit<Env>({ binding: "LIMITER", key: () => "client-1" }));
      mapHandler(app, "GET", "/api/users", () => new Response("users"));

      const res = await app.request("/api/users", {}, { LIMITER: counting("LIMITER", spent) });
      const body = await res.text();
      expect({ status: res.status, spent }).toEqual(expected);
      if (expected.status === 500) {
        expect(body).toContain('"LIMITER"');
        expect(body).toContain("`rateLimits`");
      } else {
        expect(body).toBe("users");
      }
    });
  }
});

const CSRF_SECRET = "38f516127047072640d79f757593f8c971ed2324a5e1db688f6f129f9b0478db";
const SAME_ORIGIN = { origin: "http://localhost", "CF-Connecting-IP": "203.0.113.7" };
const CROSS_ORIGIN = { origin: "https://evil.example.net", "CF-Connecting-IP": "203.0.113.7" };

type LimitedEnv = { LIMITER: RateLimit };

/** One app's record of what ran, in order: limiter calls, ring resolutions, body reads, refusals, probes. */
function csrfWorld(ring: KeyRing) {
  const events: string[] = [];
  return {
    events,
    ring: () => {
      events.push("ring");
      return ring;
    },
    onRefuse:
      (label: string): RefuseHook =>
      (_context, refusal) => {
        if (refusal.guard !== "csrf") return defaultRefusalResponse(refusal);
        events.push(`${label}:${refusal.reason}`);
        return new Response(`${label} refused: ${refusal.reason}`, { status: refusal.status });
      },
    env: (success = true): LimitedEnv => ({
      LIMITER: {
        limit: async () => {
          events.push("limit");
          return { success };
        },
      },
    }),
    post: (headers: Record<string, string>, fields = "name=Ada"): RequestInit =>
      ({
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: new ReadableStream(
          {
            pull(controller) {
              events.push("body");
              controller.enqueue(new TextEncoder().encode(fields));
              controller.close();
            },
          },
          { highWaterMark: 0 },
        ),
        duplex: "half",
      }) as RequestInit,
  };
}

function publishRefuseHook(hook: RefuseHook): Middleware {
  return (context, next) => {
    refuseHookCtx.set(context, hook);
    return next();
  };
}

function recordingHandler(label: string, events: string[]): () => Response {
  return () => {
    events.push("handler");
    return new Response(label);
  };
}

describe("a csrf policy verified after a guard group's shape, origin and rate limit (BOUNDARIES §2c)", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  function orderedGroup(world: ReturnType<typeof csrfWorld>): MiddlewareGuardGroup<LimitedEnv> {
    return {
      paths: ["/guarded"],
      shape: [probe("shape", world.events)],
      origin: { allowedOrigins: ["http://localhost"] },
      rateLimit: { binding: "LIMITER" },
      guards: [probe("guard", world.events)],
    };
  }

  const mounts: { name: string; mount: (app: Forge<LimitedEnv>, world: ReturnType<typeof csrfWorld>) => void }[] = [
    {
      name: "applyMiddlewareChain",
      mount: (app, world) =>
        applyMiddlewareChain(app, {
          ...DECLARES_LIMITER,
          securityHeaders: {},
          trustCfHeaders: true,
          onRefuse: world.onRefuse("policy"),
          csrf: { paths: ["/guarded"], ring: world.ring, subject: false },
          guards: [orderedGroup(world)],
        }),
    },
    {
      name: "buildGuardChain",
      mount: (app, world) => {
        app.use("*", trustingCf, publishRefuseHook(world.onRefuse("policy")), csrfMintStage({ ring: world.ring, subject: false }));
        app.use("/guarded", ...buildGuardChain(orderedGroup(world)));
      },
    },
  ];

  const requests: {
    name: string;
    init: (world: ReturnType<typeof csrfWorld>, token: string) => RequestInit;
    allowed?: boolean;
    expected: { status: number; body: string; events: string[] };
  }[] = [
    {
      name: "answers a cross-origin POST 403 before the limiter, the ring or the body is touched",
      init: (world) => world.post(CROSS_ORIGIN),
      expected: { status: 403, body: "Forbidden", events: ["shape"] },
    },
    {
      name: "answers an over-limit POST 429 before the ring or the body is touched",
      init: (world) => world.post(SAME_ORIGIN),
      allowed: false,
      expected: { status: 429, body: "Too many requests. Please try again later.", events: ["shape", "limit"] },
    },
    {
      name: "refuses a tokenless POST as missing-token after the rate limit, and never runs the group's guard",
      init: (world) => world.post(SAME_ORIGIN),
      expected: { status: 403, body: "policy refused: missing-token", events: ["shape", "limit", "body", "ring", "policy:missing-token"] },
    },
    {
      name: "verifies a valid token once, then runs the group's guard and the handler",
      init: (world, token) => world.post({ ...SAME_ORIGIN, "x-csrf-token": token }),
      expected: { status: 200, body: "handled", events: ["shape", "limit", "ring", "guard", "handler"] },
    },
  ];

  for (const { name, mount } of mounts) {
    describe(`through ${name}`, () => {
      for (const request of requests) {
        it(request.name, async () => {
          const world = csrfWorld(ring);
          const app = new Forge<LimitedEnv>();
          mount(app, world);
          mapHandler(app, "POST", "/guarded", recordingHandler("handled", world.events));
          const token = await createCsrfToken(ring, "/guarded");

          const res = await app.request("/guarded", request.init(world, token), world.env(request.allowed ?? true));

          expect({ status: res.status, body: await res.text(), events: world.events }).toEqual(request.expected);
        });
      }
    });
  }

  it("verifies once, after every overlapping group's rate limit and before any group's guards", async () => {
    const world = csrfWorld(ring);
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      trustCfHeaders: true,
      onRefuse: world.onRefuse("policy"),
      csrf: { paths: ["/account/*"], ring: world.ring, subject: false },
      guards: [
        { paths: ["/account/*"], guards: [probe("account-guard", world.events)] },
        { paths: ["/account/passkey"], rateLimit: { binding: "LIMITER" }, guards: [probe("passkey-guard", world.events)] },
      ],
    });
    mapHandler(app, "POST", "/account/passkey", recordingHandler("handled", world.events));
    const token = await createCsrfToken(ring, "/account/passkey");

    const refused = await app.request("/account/passkey", world.post({ ...SAME_ORIGIN, "x-csrf-token": "forged.token" }), world.env());
    const refusedEvents = world.events.splice(0);
    const passed = await app.request("/account/passkey", world.post({ ...SAME_ORIGIN, "x-csrf-token": token }), world.env());

    expect({ refused: [refused.status, refusedEvents[0]], passed: [passed.status, world.events] }).toEqual({
      refused: [403, "limit"],
      passed: [200, ["limit", "ring", "account-guard", "passkey-guard", "handler"]],
    });
  });

  it("does not verify again in the router's final stage once a group has verified", async () => {
    const world = csrfWorld(ring);
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      trustCfHeaders: true,
      onRefuse: world.onRefuse("policy"),
      csrf: { paths: ["/guarded"], ring: world.ring, subject: false },
      guards: [
        {
          paths: ["/guarded"],
          guards: [
            async (context, next) => {
              context.request.headers.set("x-csrf-token", "forged.token");
              return next();
            },
          ],
        },
      ],
    });
    mapHandler(app, "POST", "/guarded", recordingHandler("handled", world.events));
    const token = await createCsrfToken(ring, "/guarded");

    const res = await app.request("/guarded", world.post({ ...SAME_ORIGIN, "x-csrf-token": token }), world.env());

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 200,
      body: "handled",
      events: ["ring", "handler"],
    });
  });
});

describe("a csrf policy on paths no guard group covers", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  function ungroupedApp(world: ReturnType<typeof csrfWorld>): Forge<LimitedEnv> {
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      onRefuse: world.onRefuse("policy"),
      csrf: { ring: world.ring, subject: false },
      guards: [{ paths: ["/guarded"], guards: [probe("guard", world.events)] }],
    });
    mapHandler(app, "GET", "/page", async (c) => new Response(await mintCsrf(c, "/action")));
    mapHandler(app, "POST", "/action", recordingHandler("acted", world.events));
    return app;
  }

  it("lets a GET handler mint a token the action's path verifies, resolving the ring only to mint", async () => {
    const world = csrfWorld(ring);
    const res = await ungroupedApp(world).request("/page", {}, world.env());
    const token = await res.text();

    expect({ status: res.status, verdict: await verifyCsrfToken(ring, token, "/action"), events: world.events }).toEqual({
      status: 200,
      verdict: { ok: true },
      events: ["ring"],
    });
  });

  it("refuses a tokenless POST in the router's final stage, before the handler", async () => {
    const world = csrfWorld(ring);
    const res = await ungroupedApp(world).request("/action", world.post(SAME_ORIGIN), world.env());

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 403,
      body: "policy refused: missing-token",
      events: ["body", "ring", "policy:missing-token"],
    });
  });

  it("passes a POST carrying the token the GET minted", async () => {
    const world = csrfWorld(ring);
    const app = ungroupedApp(world);
    const token = await (await app.request("/page", {}, world.env())).text();

    const res = await app.request("/action", world.post({ ...SAME_ORIGIN, "x-csrf-token": token }), world.env());

    expect({ status: res.status, body: await res.text(), refusals: world.events.filter((e) => e.startsWith("policy:")) }).toEqual({
      status: 200,
      body: "acted",
      refusals: [],
    });
  });

  for (const { name, path } of [
    { name: "a URL no route serves", path: "/nowhere" },
    { name: "a route that serves only GET", path: "/page" },
  ]) {
    it(`refuses a tokenless POST to ${name} 403, ahead of the router's own answer`, async () => {
      const world = csrfWorld(ring);
      const res = await ungroupedApp(world).request(path, world.post(SAME_ORIGIN), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 403,
        body: "policy refused: missing-token",
        events: ["body", "ring", "policy:missing-token"],
      });
    });
  }

  it("publishes the minter after session and before globals, bound to the subject the session set", async () => {
    const subjectVar = contextVar<string>("chain-test-subject");
    const world = csrfWorld(ring);
    let minted = "";
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      session: sessionSlot(async (context, next) => {
        subjectVar.set(context, "session-a");
        return next();
      }),
      csrf: { ring: world.ring, subject: (c) => subjectVar.getOptional(c) },
      globals: [
        async (context, next) => {
          minted = await mintCsrf(context, "/action");
          return next();
        },
      ],
    });
    mapHandler(app, "GET", "/page", () => new Response("page"));

    const res = await app.request("/page");

    expect({ status: res.status, verdict: await verifyCsrfToken(ring, minted, "/action", { subject: "session-a" }) }).toEqual({
      status: 200,
      verdict: { ok: true },
    });
  });
});

describe("a guard group mounted by buildGuardChain after the chain", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  const requests: {
    name: string;
    headers: Record<string, string>;
    allowed: boolean;
    late?: boolean;
    token?: boolean;
    expected: { status: number; body: string; events: string[] };
  }[] = [
    {
      name: "answers a cross-origin POST from its origin check, before the policy verifies",
      headers: CROSS_ORIGIN,
      allowed: true,
      expected: { status: 403, body: "Forbidden", events: [] },
    },
    {
      name: "answers an over-limit POST from its rate limit, before the policy verifies",
      headers: SAME_ORIGIN,
      allowed: false,
      expected: { status: 429, body: "Too many requests. Please try again later.", events: ["limit"] },
    },
    {
      name: "refuses a tokenless POST from the policy once origin and rate limit have passed",
      headers: SAME_ORIGIN,
      allowed: true,
      expected: { status: 403, body: "policy refused: missing-token", events: ["limit", "body", "ring", "policy:missing-token"] },
    },
    {
      name: "refuses a tokenless POST inside its own chain, ahead of middleware registered after it",
      headers: SAME_ORIGIN,
      allowed: true,
      late: true,
      expected: { status: 403, body: "policy refused: missing-token", events: ["limit", "body", "ring", "policy:missing-token"] },
    },
    {
      name: "passes a valid-token POST through its own chain to middleware registered after it",
      headers: SAME_ORIGIN,
      allowed: true,
      late: true,
      token: true,
      expected: { status: 200, body: "handled", events: ["limit", "ring", "late", "handler"] },
    },
  ];

  for (const { name, headers, allowed, late, token, expected } of requests) {
    it(name, async () => {
      const world = csrfWorld(ring);
      const app = new Forge<LimitedEnv>();
      applyMiddlewareChain(app, {
        securityHeaders: {},
        trustCfHeaders: true,
        onRefuse: world.onRefuse("policy"),
        csrf: { paths: ["/late"], ring: world.ring, subject: false },
      });
      app.use(
        ["/late"],
        ...buildGuardChain<LimitedEnv>({ paths: ["/late"], origin: { allowedOrigins: ["http://localhost"] }, rateLimit: { binding: "LIMITER" } }),
      );
      if (late) app.use("/late", probe("late", world.events));
      mapHandler(app, "POST", "/late", recordingHandler("handled", world.events));
      const tokenHeader = token ? { "x-csrf-token": await createCsrfToken(ring, "/late") } : {};

      const res = await app.request("/late", world.post({ ...headers, ...tokenHeader }), world.env(allowed));

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual(expected);
    });
  }

  describe("a chain group with only an origin check, covering the late group's path, verifies before the late group's rate limit", () => {
    function lateLimitBehindOriginGroup(world: ReturnType<typeof csrfWorld>): Forge<LimitedEnv> {
      const app = new Forge<LimitedEnv>();
      applyMiddlewareChain(app, {
        securityHeaders: {},
        trustCfHeaders: true,
        onRefuse: world.onRefuse("policy"),
        csrf: { paths: ["/late"], ring: world.ring, subject: false },
        guards: [{ paths: ["/late"], origin: { allowedOrigins: ["http://localhost"] } }],
      });
      app.use("/late", ...buildGuardChain<LimitedEnv>({ paths: ["/late"], rateLimit: { binding: "LIMITER" } }));
      mapHandler(app, "POST", "/late", recordingHandler("handled", world.events));
      return app;
    }

    it("refuses a tokenless POST without consulting the late group's limiter", async () => {
      const world = csrfWorld(ring);

      const res = await lateLimitBehindOriginGroup(world).request("/late", world.post(SAME_ORIGIN), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 403,
        body: "policy refused: missing-token",
        events: ["body", "ring", "policy:missing-token"],
      });
    });

    it("verifies a valid token before the late group's limiter runs", async () => {
      const world = csrfWorld(ring);
      const token = await createCsrfToken(ring, "/late");

      const res = await lateLimitBehindOriginGroup(world).request("/late", world.post({ ...SAME_ORIGIN, "x-csrf-token": token }), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 200,
        body: "handled",
        events: ["ring", "limit", "handler"],
      });
    });
  });
});

describe("a guard group with an origin check or a rate limit verifies without the final stage", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  const swapToForgedToken: Middleware = async (context, next) => {
    context.request.headers.set("x-csrf-token", "forged.token");
    return next();
  };

  function lateApp(world: ReturnType<typeof csrfWorld>, groups: MiddlewareGuardGroup<LimitedEnv>[], ...late: Middleware[]): Forge<LimitedEnv> {
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      trustCfHeaders: true,
      onRefuse: world.onRefuse("policy"),
      csrf: { paths: ["/g"], ring: world.ring, subject: false },
      guards: groups,
    });
    app.use("/g", probe("late", world.events), ...late);
    mapHandler(app, "POST", "/g", recordingHandler("handled", world.events));
    return app;
  }

  const groups: {
    name: string;
    group: (world: ReturnType<typeof csrfWorld>) => MiddlewareGuardGroup<LimitedEnv>;
    requests: {
      name: string;
      headers: Record<string, string>;
      token?: boolean;
      allowed?: boolean;
      expected: { status: number; body: string; events: string[] };
    }[];
  }[] = [
    {
      name: "a rateLimit-only group",
      group: () => ({ paths: ["/g"], rateLimit: { binding: "LIMITER" } }),
      requests: [
        {
          name: "answers an over-limit POST 429 before the body or the ring is touched",
          headers: SAME_ORIGIN,
          allowed: false,
          expected: { status: 429, body: "Too many requests. Please try again later.", events: ["limit"] },
        },
        {
          name: "refuses a tokenless POST after its limit, before middleware registered after the chain",
          headers: SAME_ORIGIN,
          expected: { status: 403, body: "policy refused: missing-token", events: ["limit", "body", "ring", "policy:missing-token"] },
        },
        {
          name: "passes a valid-token POST, verified after its limit",
          headers: SAME_ORIGIN,
          token: true,
          expected: { status: 200, body: "handled", events: ["limit", "ring", "late", "handler"] },
        },
      ],
    },
    {
      name: "an origin-only group",
      group: () => ({ paths: ["/g"], origin: { allowedOrigins: ["http://localhost"] } }),
      requests: [
        {
          name: "answers a cross-origin POST 403 before the body or the ring is touched",
          headers: CROSS_ORIGIN,
          expected: { status: 403, body: "Forbidden", events: [] },
        },
        {
          name: "refuses a tokenless same-origin POST after its origin check, before middleware registered after the chain",
          headers: SAME_ORIGIN,
          expected: { status: 403, body: "policy refused: missing-token", events: ["body", "ring", "policy:missing-token"] },
        },
        {
          name: "passes a valid-token POST, verified after its origin check",
          headers: SAME_ORIGIN,
          token: true,
          expected: { status: 200, body: "handled", events: ["ring", "late", "handler"] },
        },
      ],
    },
    {
      name: "a shape-only group",
      group: (world) => ({ paths: ["/g"], shape: [probe("shape", world.events)] }),
      requests: [
        {
          name: "leaves a tokenless POST to the router's final stage, after middleware registered after the chain",
          headers: SAME_ORIGIN,
          expected: { status: 403, body: "policy refused: missing-token", events: ["shape", "late", "body", "ring", "policy:missing-token"] },
        },
        {
          name: "passes a valid-token POST, verified in the router's final stage",
          headers: SAME_ORIGIN,
          token: true,
          expected: { status: 200, body: "handled", events: ["shape", "late", "ring", "handler"] },
        },
      ],
    },
  ];

  for (const { name, group, requests } of groups) {
    describe(`through ${name}`, () => {
      for (const request of requests) {
        it(request.name, async () => {
          const world = csrfWorld(ring);
          const app = lateApp(world, [group(world)]);
          const tokenHeader = request.token ? { "x-csrf-token": await createCsrfToken(ring, "/g") } : {};

          const res = await app.request("/g", world.post({ ...request.headers, ...tokenHeader }), world.env(request.allowed ?? true));

          expect({ status: res.status, body: await res.text(), events: world.events }).toEqual(request.expected);
        });
      }
    });
  }

  it("does not verify again in the router's final stage once an origin-only group has verified", async () => {
    const world = csrfWorld(ring);
    const app = lateApp(world, [{ paths: ["/g"], origin: { allowedOrigins: ["http://localhost"] } }], swapToForgedToken);
    const token = await createCsrfToken(ring, "/g");

    const res = await app.request("/g", world.post({ ...SAME_ORIGIN, "x-csrf-token": token }), world.env());

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 200,
      body: "handled",
      events: ["ring", "late", "handler"],
    });
  });

  describe("across two verifying groups and the router's final stage", () => {
    function twoGroupApp(world: ReturnType<typeof csrfWorld>): Forge<LimitedEnv> {
      return lateApp(
        world,
        [
          { paths: ["/g"], origin: { allowedOrigins: ["http://localhost"] }, guards: [swapToForgedToken] },
          { paths: ["/g"], rateLimit: { binding: "LIMITER" } },
        ],
        swapToForgedToken,
      );
    }

    it("checks a valid token once, so neither the second group nor the final stage sees the swapped token", async () => {
      const world = csrfWorld(ring);
      const token = await createCsrfToken(ring, "/g");

      const res = await twoGroupApp(world).request("/g", world.post({ ...SAME_ORIGIN, "x-csrf-token": token }), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 200,
        body: "handled",
        events: ["limit", "ring", "late", "handler"],
      });
    });

    it("refuses a tokenless POST once, after both groups' origin check and limit", async () => {
      const world = csrfWorld(ring);

      const res = await twoGroupApp(world).request("/g", world.post(SAME_ORIGIN), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 403,
        body: "policy refused: missing-token",
        events: ["limit", "body", "ring", "policy:missing-token"],
      });
    });
  });
});

describe("applyMiddlewareChain — the root's csrf policy", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  it("mints and verifies on the paths the root policy names", async () => {
    const world = csrfWorld(ring);
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      onRefuse: world.onRefuse("chain"),
      csrf: { paths: ["/contributed/*"], ring: world.ring, subject: false },
    });
    for (const path of ["/contributed/save", "/open/save"]) mapHandler(app, "POST", path, () => new Response(`saved ${path}`));

    const answers: [number, string][] = [];
    for (const path of ["/contributed/save", "/open/save"]) {
      const res = await app.request(path, world.post(SAME_ORIGIN));
      answers.push([res.status, await res.text()]);
    }

    expect(answers).toEqual([
      [403, "chain refused: missing-token"],
      [200, "saved /open/save"],
    ]);
  });

  it("mints on a contributed slice's page and verifies on its action, refusing a missing or forged token before the slice's guards", async () => {
    const world = csrfWorld(ring);
    const slice: string[] = [];
    const contribution: MiddlewareContribution = {
      globals: [probe("slice-global", slice)],
      guards: [{ paths: ["/contributed/*"], origin: { allowedOrigins: ["http://localhost"] }, guards: [probe("slice-guard", slice)] }],
    };
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      onRefuse: world.onRefuse("root"),
      csrf: { paths: ["/contributed/*"], ring: world.ring, subject: false },
      contributions: [contribution],
    });
    mapHandler(app, "GET", "/contributed/form", async (c) => new Response(await mintCsrf(c, "/contributed/save")));
    mapHandler(app, "POST", "/contributed/save", recordingHandler("saved", slice));

    const minted = await (await app.request("/contributed/form")).text();
    const elsewhere = await createCsrfToken(ring, "/elsewhere");
    const forged = `${minted.slice(0, minted.indexOf("."))}${elsewhere.slice(elsewhere.indexOf("."))}`;
    slice.length = 0;
    const answer = async (headers: Record<string, string>) => {
      const res = await app.request("/contributed/save", world.post({ ...SAME_ORIGIN, ...headers }));
      return [res.status, await res.text(), slice.splice(0)];
    };

    expect({
      minted: await answer({ "x-csrf-token": minted }),
      missing: await answer({}),
      forged: await answer({ "x-csrf-token": forged }),
    }).toEqual({
      minted: [200, "saved", ["slice-global", "slice-guard", "handler"]],
      missing: [403, "root refused: missing-token", ["slice-global"]],
      forged: [403, "root refused: invalid-signature", ["slice-global"]],
    });
  });

  describe("refuses a contribution carrying a csrf policy, naming its index and the root csrf option, and registers nothing", () => {
    const CARRIER_REFUSAL =
      "applyMiddlewareChain: contribution 1 carries a csrf policy, and the app root owns it — move it to applyMiddlewareChain's root csrf option.";
    const sliceGuard = (order: string[]) => ({ paths: ["/"], guards: [probe("slice-guard", order)] });

    async function refusedChainAnswer(order: string[], contributions: readonly MiddlewareContribution[]) {
      const app = new Forge();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      expect(() =>
        applyMiddlewareChain(app, { before: [probe("before", order)], securityHeaders: {}, globals: [probe("global", order)], contributions }),
      ).toThrow(new Error(CARRIER_REFUSAL));
      mapHandler(app, "POST", "/", () => {
        order.push("handler");
        return new Response("ok");
      });

      const res = await app.request("/", csrfWorld(ring).post(SAME_ORIGIN));
      return { status: res.status, body: await res.text(), nosniff: res.headers.get("x-content-type-options"), order };
    }

    const UNREGISTERED = { status: 200, body: "ok", nosniff: null, order: ["handler"] };

    it("when the contribution is an object literal in the contributions array", async () => {
      const order: string[] = [];

      const answer = await refusedChainAnswer(order, [
        { globals: [probe("contributed-global", order)] },
        {
          guards: [sliceGuard(order)],
          // @ts-expect-error -- `MiddlewareContribution.csrf` is `never`; the app root owns the policy
          csrf: { paths: ["/*"], ring: () => ring, subject: false },
        },
      ]);

      expect(answer).toEqual(UNREGISTERED);
    });

    it("when the contribution is an object literal in an array an arrow function returns", async () => {
      const order: string[] = [];
      const contribute = (): MiddlewareContribution[] => [
        { globals: [probe("contributed-global", order)] },
        {
          guards: [sliceGuard(order)],
          // @ts-expect-error -- `MiddlewareContribution.csrf` is `never`; the app root owns the policy
          csrf: { paths: ["/*"], ring: () => ring, subject: false },
        },
      ];

      expect(await refusedChainAnswer(order, contribute())).toEqual(UNREGISTERED);
    });

    it("when the contribution is held in an unannotated variable", async () => {
      const order: string[] = [];
      const slice = { guards: [sliceGuard(order)], csrf: { paths: ["/*"], ring: () => ring, subject: false } };

      const answer = await refusedChainAnswer(order, [
        { globals: [probe("contributed-global", order)] },
        // @ts-expect-error -- `MiddlewareContribution.csrf` is `never`, so a variable carrying one is refused too
        slice,
      ]);

      expect(answer).toEqual(UNREGISTERED);
    });
  });
});

describe('applyMiddlewareChain — the session slot and subject "session"', () => {
  const SESSION_SECRET = "5d2a9c4e8f1b3a6d7e0c9b8a7f6e5d4c3b2a1908f7e6d5c4b3a2918f7e6d5c4b";
  const NO_SESSION_SLOT = 'applyMiddlewareChain: the csrf policy\'s subject is "session", but no source supplies a session slot to bind it to.';
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  it("throws on the first request, naming the slot, when the session slot's middleware sets no session", async () => {
    const events: string[] = [];
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    const unset = brandSessionMiddleware((_context, next) => {
      events.push("session");
      return next();
    }, undefined);
    expect(() => applyMiddlewareChain(app, { securityHeaders: {}, session: unset, globals: [probe("global", events)] })).not.toThrow();
    mapHandler(app, "GET", "/", recordingHandler("ok", events));

    const res = await app.request("/");

    expect({ status: res.status, body: await res.text(), events }).toEqual({
      status: 500,
      body: "applyMiddlewareChain: the `session` slot's middleware set no session on sessionCtx — pass the SessionMiddleware createAnonymousSession or sessionMiddleware returns.",
      events: ["session"],
    });
  });

  it('throws at registration on subject "session" when no source supplies a session slot, registering nothing', () => {
    const sources: MiddlewareChainOptions[] = [{ securityHeaders: {}, csrf: { ring: () => ring, subject: "session" } }];

    for (const options of sources) {
      const app = new Forge();
      const use = spyOn(app, "use");
      expect(() => applyMiddlewareChain(app, options)).toThrow(new Error(NO_SESSION_SLOT));
      expect(use).toHaveBeenCalledTimes(0);
    }
  });

  it('registers subject "session" beside a session slot from the options or from any contribution', () => {
    const sources: MiddlewareChainOptions[] = [
      { securityHeaders: {}, session: sessionSlot(), csrf: { ring: () => ring, subject: "session" } },
      { securityHeaders: {}, csrf: { ring: () => ring, subject: "session" }, contributions: [{ session: sessionSlot() }] },
    ];

    for (const options of sources) expect(() => applyMiddlewareChain(new Forge(), options)).not.toThrow();
  });

  it("mints and verifies path-only tokens with no session slot and subject false", async () => {
    const world = csrfWorld(ring);
    const app = new Forge();
    applyMiddlewareChain(app, { securityHeaders: {}, onRefuse: world.onRefuse("policy"), csrf: { ring: world.ring, subject: false } });
    mapHandler(app, "GET", "/page", async (c) => new Response(await mintCsrf(c, "/action")));
    mapHandler(app, "POST", "/action", recordingHandler("acted", world.events));

    const token = await (await app.request("/page")).text();
    const res = await app.request("/action", world.post({ "x-csrf-token": token }));

    expect({
      status: res.status,
      body: await res.text(),
      underASubject: await verifyCsrfToken(ring, token, "/action", { subject: "anyone" }),
    }).toEqual({ status: 200, body: "acted", underASubject: { ok: false, error: "subject-mismatch" } });
  });

  it('verifies one page\'s bound and unbound tokens under subject "session" with an unbound target path', async () => {
    const world = csrfWorld(ring);
    const cookie = createSignedCookie("__session", { path: "/", ring: await importKeyRing([SESSION_SECRET]) });
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      onRefuse: world.onRefuse("policy"),
      session: sessionMiddleware(createCookieSessionStorage(), cookie),
      csrf: { ring: world.ring, subject: "session", unboundPaths: ["/api/contact"] },
    });
    mapHandler(app, "GET", "/page", async (c) =>
      Response.json({ id: sessionCtx.get(c).id, bound: await mintCsrf(c, "/api/fica"), unbound: await mintCsrf(c, "/api/contact") }),
    );
    for (const path of ["/api/fica", "/api/contact"]) mapHandler(app, "POST", path, () => new Response(`handled ${path}`));

    const page = await app.request("/page");
    const { id, bound, unbound } = (await page.json()) as { id: string; bound: string; unbound: string };
    const carried = { cookie: (page.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "" };
    const answer = async (path: string, headers: Record<string, string>) => {
      const res = await app.request(path, world.post(headers));
      return [res.status, await res.text()];
    };

    expect({
      bound: await answer("/api/fica", { ...carried, "x-csrf-token": bound }),
      unbound: await answer("/api/contact", { ...carried, "x-csrf-token": unbound }),
      boundUnderAFreshSession: await answer("/api/fica", { "x-csrf-token": bound }),
      unboundUnderAFreshSession: await answer("/api/contact", { "x-csrf-token": unbound }),
      boundToTheSessionId: await verifyCsrfToken(ring, bound, "/api/fica", { subject: id }),
    }).toEqual({
      bound: [200, "handled /api/fica"],
      unbound: [200, "handled /api/contact"],
      boundUnderAFreshSession: [403, "policy refused: subject-mismatch"],
      unboundUnderAFreshSession: [200, "handled /api/contact"],
      boundToTheSessionId: { ok: true },
    });
  });
});

describe("applyMiddlewareChain — a contribution's sessionMaxAgeAtLeastMs", () => {
  const HOUR_MS = 3_600_000;
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  /** The session slot `sessionMiddleware` returns over a signed cookie lasting `maxAge` seconds, or setting no maxAge when omitted. */
  const lasting = (maxAge?: number): SessionMiddleware =>
    sessionMiddleware(
      createCookieSessionStorage(),
      createSignedCookie("__session", { path: "/", ring, ...(maxAge === undefined ? {} : { maxAge }) }),
    );

  it("accepts a 1-minute cookie, and a chain with no session slot, when no contribution states a lifetime", () => {
    const sources: MiddlewareChainOptions[] = [
      { securityHeaders: {}, session: lasting(60), contributions: [{ globals: [] }] },
      { securityHeaders: {}, contributions: [{ session: lasting(60) }, { sessionMaxAgeAtLeastMs: undefined }] },
      { securityHeaders: {}, contributions: [{ globals: [] }] },
    ];

    for (const options of sources) expect(() => applyMiddlewareChain(new Forge(), options)).not.toThrow();
  });

  it("throws at registration when a contribution states a lifetime and no source supplies a session slot, registering nothing", () => {
    const app = new Forge();
    const use = spyOn(app, "use");

    expect(() => applyMiddlewareChain(app, { securityHeaders: {}, contributions: [{ sessionMaxAgeAtLeastMs: 2 * HOUR_MS }] })).toThrow(
      new Error(
        "applyMiddlewareChain: a contribution needs the session cookie to last at least 7200 seconds (2 hours), but no source supplies a session slot.",
      ),
    );
    expect(use).toHaveBeenCalledTimes(0);
  });

  it("holds the slot to the largest lifetime any contribution states, in either order and from either session source", () => {
    const refused = new Error(
      "applyMiddlewareChain: the session slot's cookie maxAge is 3600 seconds (1 hour), shorter than the 7200 seconds (2 hours) a contribution needs it to last — set maxAge to at least 7200.",
    );
    const needs = [{ sessionMaxAgeAtLeastMs: HOUR_MS }, { sessionMaxAgeAtLeastMs: 2 * HOUR_MS }];
    const refusing: MiddlewareChainOptions[] = [
      { securityHeaders: {}, session: lasting(3_600), contributions: needs },
      { securityHeaders: {}, session: lasting(3_600), contributions: [...needs].reverse() },
      { securityHeaders: {}, contributions: [{ session: lasting(3_600) }, ...needs] },
    ];

    for (const options of refusing) expect(() => applyMiddlewareChain(new Forge(), options)).toThrow(refused);
    expect(() => applyMiddlewareChain(new Forge(), { securityHeaders: {}, session: lasting(7_200), contributions: needs })).not.toThrow();
  });

  it("rounds a lifetime that is not a whole second up: 90.5 seconds refuses a 90-second cookie and admits a 91-second one", () => {
    const needs = [{ sessionMaxAgeAtLeastMs: 90_500 }];

    expect(() => applyMiddlewareChain(new Forge(), { securityHeaders: {}, session: lasting(90), contributions: needs })).toThrow(
      new Error(
        "applyMiddlewareChain: the session slot's cookie maxAge is 90 seconds (90 seconds), shorter than the 91 seconds (91 seconds) a contribution needs it to last — set maxAge to at least 91.",
      ),
    );
    expect(() => applyMiddlewareChain(new Forge(), { securityHeaders: {}, session: lasting(91), contributions: needs })).not.toThrow();
  });

  it("throws at registration on a session slot whose cookie sets no maxAge", () => {
    expect(() =>
      applyMiddlewareChain(new Forge(), { securityHeaders: {}, session: lasting(), contributions: [{ sessionMaxAgeAtLeastMs: 1_000 }] }),
    ).toThrow(
      new Error(
        "applyMiddlewareChain: a contribution needs the session cookie to last at least 1 seconds (1 second), but the session slot's cookie sets no maxAge — set maxAge to at least 1.",
      ),
    );
  });
});

describe("applyMiddlewareChain — a contribution's csrfCovers", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  const mounted: MiddlewareContribution = { csrfCovers: ["/members/signin", "/members/signout"] };

  /** Registers `mounted` behind an unrelated contribution under `csrf`, or under no csrf policy when omitted. */
  function register(app: Forge, csrf?: Omit<NonNullable<MiddlewareChainOptions["csrf"]>, "ring" | "subject">): void {
    applyMiddlewareChain(app, {
      securityHeaders: {},
      ...(csrf === undefined ? {} : { csrf: { ...csrf, ring: () => ring, subject: false } }),
      contributions: [{ globals: [] }, mounted],
    });
  }

  it("throws at registration on an exclude entry covering the mount, naming the route, its contribution and the entry, registering nothing", () => {
    const app = new Forge();
    const use = spyOn(app, "use");

    expect(() => register(app, { exclude: ["/public/*", "/members/*"] })).toThrow(
      new Error(
        "applyMiddlewareChain: contribution 1's route `/members/signin` mints a CSRF token, but the csrf policy's exclude entry `/members/*` skips it — narrow the entry so it leaves the route covered.",
      ),
    );
    expect(use).toHaveBeenCalledTimes(0);
  });

  it("throws at registration on paths narrowed past one of the mount's routes, naming the route and the paths", () => {
    expect(() => register(new Forge(), { paths: ["/app/*", "/members/signin"] })).toThrow(
      new Error(
        "applyMiddlewareChain: contribution 1's route `/members/signout` mints a CSRF token, but the csrf policy's paths `/app/*, /members/signin` leave it uncovered — add a pattern that matches it.",
      ),
    );
  });

  it("throws at registration when no csrf policy is set", () => {
    expect(() => register(new Forge())).toThrow(
      new Error(
        "applyMiddlewareChain: contribution 1's route `/members/signin` mints a CSRF token, but no csrf policy is set — pass applyMiddlewareChain's root csrf option.",
      ),
    );
  });

  it("registers under the default paths, paths naming the mount, and an exclude beside it", () => {
    expect(() => register(new Forge(), {})).not.toThrow();
    expect(() => register(new Forge(), { paths: ["/members/*"] })).not.toThrow();
    expect(() => register(new Forge(), { exclude: ["/public/*", "/membership/*", "/members"] })).not.toThrow();
  });

  it("names the one exclude entry matching the route among several that do not", () => {
    expect(() => register(new Forge(), { exclude: ["/public/*", "/members/signup", "/members/signout", "/assets/*"] })).toThrow(
      new Error(
        "applyMiddlewareChain: contribution 1's route `/members/signout` mints a CSRF token, but the csrf policy's exclude entry `/members/signout` skips it — narrow the entry so it leaves the route covered.",
      ),
    );
  });

  it("names a catch-all exclude entry", () => {
    expect(() => register(new Forge(), { exclude: ["/public/*", "*"] })).toThrow(
      new Error(
        "applyMiddlewareChain: contribution 1's route `/members/signin` mints a CSRF token, but the csrf policy's exclude entry `*` skips it — narrow the entry so it leaves the route covered.",
      ),
    );
  });

  it("throws on paths naming the mount's prefix exactly, which leaves its routes uncovered", () => {
    expect(() => register(new Forge(), { paths: ["/members"] })).toThrow(
      new Error(
        "applyMiddlewareChain: contribution 1's route `/members/signin` mints a CSRF token, but the csrf policy's paths `/members` leave it uncovered — add a pattern that matches it.",
      ),
    );
  });

  it("names the index of the offending contribution among several that ask for cover", () => {
    expect(() =>
      applyMiddlewareChain(new Forge(), {
        securityHeaders: {},
        csrf: { ring: () => ring, subject: false, exclude: ["/admin/approve"] },
        contributions: [{ csrfCovers: ["/members/signin"] }, { globals: [] }, { csrfCovers: ["/admin/approve"] }],
      }),
    ).toThrow(
      new Error(
        "applyMiddlewareChain: contribution 2's route `/admin/approve` mints a CSRF token, but the csrf policy's exclude entry `/admin/approve` skips it — narrow the entry so it leaves the route covered.",
      ),
    );
  });

  describe("covers a guard group carries", () => {
    const group: MiddlewareGuardGroup = { paths: ["/auth/*"], guards: [], csrfCovers: ["/auth/signin", "/auth/signout"] };

    it("throws at registration on a group spread into a contribution with no covers of its own, naming the contribution and the group", () => {
      const app = new Forge();
      const use = spyOn(app, "use");

      expect(() =>
        applyMiddlewareChain(app, {
          securityHeaders: {},
          csrf: { ring: () => ring, subject: false, exclude: ["/auth/*"] },
          contributions: [{ globals: [] }, { guards: [{ paths: ["/app/*"] }, { ...group }] }],
        }),
      ).toThrow(
        new Error(
          "applyMiddlewareChain: contribution 1's guard group `/auth/*`'s route `/auth/signin` mints a CSRF token, but the csrf policy's exclude entry `/auth/*` skips it — narrow the entry so it leaves the route covered.",
        ),
      );
      expect(use).toHaveBeenCalledTimes(0);
    });

    it("throws at registration on a group passed as a root guard group, naming it", () => {
      expect(() => applyMiddlewareChain(new Forge(), { securityHeaders: {}, guards: [group] })).toThrow(
        new Error(
          "applyMiddlewareChain: the root guard group `/auth/*`'s route `/auth/signin` mints a CSRF token, but no csrf policy is set — pass applyMiddlewareChain's root csrf option.",
        ),
      );
    });

    it("names the contribution that first listed a path its groups and its own covers repeat", () => {
      expect(() =>
        applyMiddlewareChain(new Forge(), {
          securityHeaders: {},
          csrf: { ring: () => ring, subject: false, paths: ["/auth/signin"] },
          contributions: [{ csrfCovers: ["/auth/signout"], guards: [group, { ...group, paths: ["/auth/signout"] }] }],
        }),
      ).toThrow(
        new Error(
          "applyMiddlewareChain: contribution 0's route `/auth/signout` mints a CSRF token, but the csrf policy's paths `/auth/signin` leave it uncovered — add a pattern that matches it.",
        ),
      );
    });

    it("registers every group's covers under a policy that mints on them", () => {
      expect(() =>
        applyMiddlewareChain(new Forge(), {
          securityHeaders: {},
          csrf: { ring: () => ring, subject: false, exclude: ["/public/*"] },
          guards: [group],
          contributions: [{ guards: [group, group] }],
        }),
      ).not.toThrow();
    });

    it("checks a group's covers beside its contribution's own, naming the group when only its route is skipped", () => {
      expect(() =>
        applyMiddlewareChain(new Forge(), {
          securityHeaders: {},
          csrf: { ring: () => ring, subject: false, exclude: ["/auth/signout"] },
          contributions: [{ csrfCovers: ["/approve"], guards: [group] }],
        }),
      ).toThrow(
        new Error(
          "applyMiddlewareChain: contribution 0's guard group `/auth/*`'s route `/auth/signout` mints a CSRF token, but the csrf policy's exclude entry `/auth/signout` skips it — narrow the entry so it leaves the route covered.",
        ),
      );
    });

    it("checks a contribution's own covers beside its groups', naming the contribution when only its route is skipped", () => {
      expect(() =>
        applyMiddlewareChain(new Forge(), {
          securityHeaders: {},
          csrf: { ring: () => ring, subject: false, exclude: ["/approve"] },
          contributions: [{ csrfCovers: ["/approve"], guards: [group] }],
        }),
      ).toThrow(
        new Error(
          "applyMiddlewareChain: contribution 0's route `/approve` mints a CSRF token, but the csrf policy's exclude entry `/approve` skips it — narrow the entry so it leaves the route covered.",
        ),
      );
    });

    it("names the root guard group over a contribution's group listing the same route", () => {
      expect(() =>
        applyMiddlewareChain(new Forge(), {
          securityHeaders: {},
          csrf: { ring: () => ring, subject: false, exclude: ["/auth/signout"] },
          guards: [{ paths: ["/root/*"], csrfCovers: ["/auth/signout"] }],
          contributions: [{ guards: [group] }],
        }),
      ).toThrow(
        new Error(
          "applyMiddlewareChain: the root guard group `/root/*`'s route `/auth/signout` mints a CSRF token, but the csrf policy's exclude entry `/auth/signout` skips it — narrow the entry so it leaves the route covered.",
        ),
      );
    });

    it("takes covers as an optional readonly list, registering a frozen one unchanged", () => {
      const bare: MiddlewareGuardGroup = { paths: ["/app/*"] };
      const frozen: MiddlewareGuardGroup = { paths: ["/auth/*"], csrfCovers: Object.freeze(["/auth/signin"]) };

      expect(() =>
        applyMiddlewareChain(new Forge(), {
          securityHeaders: {},
          csrf: { ring: () => ring, subject: false, exclude: ["/public/*"] },
          guards: [bare, frozen],
          contributions: [{ guards: [frozen] }],
        }),
      ).not.toThrow();
      // @ts-expect-error -- a group's covers are readonly, so the chain judges the list its owner stamped
      expect(() => frozen.csrfCovers?.push("/auth/other")).toThrow(TypeError);
    });
  });

  for (const { name, csrfCovers } of [
    { name: "no csrfCovers", csrfCovers: undefined },
    { name: "an empty csrfCovers", csrfCovers: [] },
  ]) {
    it(`leaves a contribution with ${name} unchecked, with no csrf policy and under one excluding everything`, () => {
      const contributions = [{ globals: [], csrfCovers }];
      expect(() => applyMiddlewareChain(new Forge(), { securityHeaders: {}, contributions })).not.toThrow();
      expect(() =>
        applyMiddlewareChain(new Forge(), { securityHeaders: {}, csrf: { ring: () => ring, subject: false, exclude: ["*"] }, contributions }),
      ).not.toThrow();
    });
  }
});

describe("the csrf policy's paths and exclude", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  describe("a policy with no paths", () => {
    function everywhereApp(world: ReturnType<typeof csrfWorld>): Forge<LimitedEnv> {
      const app = new Forge<LimitedEnv>();
      applyMiddlewareChain(app, { securityHeaders: {}, onRefuse: world.onRefuse("policy"), csrf: { ring: world.ring, subject: false } });
      mapHandler(app, "GET", "/anything", async (c) => new Response(await mintCsrf(c, "/x")));
      mapHandler(app, "POST", "/elsewhere", recordingHandler("saved", world.events));
      return app;
    }

    it("publishes a minter on any path, whose token verifies", async () => {
      const world = csrfWorld(ring);

      const res = await everywhereApp(world).request("/anything", {}, world.env());

      expect({ status: res.status, verdict: await verifyCsrfToken(ring, await res.text(), "/x") }).toEqual({ status: 200, verdict: { ok: true } });
    });

    it("refuses a tokenless POST on any path", async () => {
      const world = csrfWorld(ring);

      const res = await everywhereApp(world).request("/elsewhere", world.post(SAME_ORIGIN), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 403,
        body: "policy refused: missing-token",
        events: ["body", "ring", "policy:missing-token"],
      });
    });

    it("passes a valid-token POST on any path", async () => {
      const world = csrfWorld(ring);
      const token = await createCsrfToken(ring, "/elsewhere");

      const res = await everywhereApp(world).request("/elsewhere", world.post({ ...SAME_ORIGIN, "x-csrf-token": token }), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 200,
        body: "saved",
        events: ["ring", "handler"],
      });
    });
  });

  describe("a policy with an exclude", () => {
    function hookedApp(world: ReturnType<typeof csrfWorld>): Forge<LimitedEnv> {
      const app = new Forge<LimitedEnv>();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      applyMiddlewareChain(app, {
        securityHeaders: {},
        onRefuse: world.onRefuse("policy"),
        csrf: { exclude: ["/hooks/*"], ring: world.ring, subject: false },
      });
      mapHandler(app, "POST", "/hooks/in", recordingHandler("hooked", world.events));
      mapHandler(app, "GET", "/hooks/page", async (c) => new Response(await mintCsrf(c, "/save")));
      mapHandler(app, "GET", "/page", async (c) => new Response(await mintCsrf(c, "/save")));
      mapHandler(app, "POST", "/save", recordingHandler("saved", world.events));
      return app;
    }

    it("lets a tokenless POST on an excluded path reach the handler without reading the body or the ring", async () => {
      const world = csrfWorld(ring);

      const res = await hookedApp(world).request("/hooks/in", world.post(SAME_ORIGIN), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({ status: 200, body: "hooked", events: ["handler"] });
    });

    it("publishes no minter on an excluded path", async () => {
      const world = csrfWorld(ring);

      const res = await hookedApp(world).request("/hooks/page", {}, world.env());

      expect({ status: res.status, events: world.events }).toEqual({ status: 500, events: [] });
      expect(await res.text()).toContain("no CSRF minter on context");
    });

    it("still publishes a minter outside the exclude, whose token verifies", async () => {
      const world = csrfWorld(ring);

      const res = await hookedApp(world).request("/page", {}, world.env());

      expect({ status: res.status, verdict: await verifyCsrfToken(ring, await res.text(), "/save") }).toEqual({
        status: 200,
        verdict: { ok: true },
      });
    });

    it("still refuses a tokenless POST outside the exclude", async () => {
      const world = csrfWorld(ring);

      const res = await hookedApp(world).request("/save", world.post(SAME_ORIGIN), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 403,
        body: "policy refused: missing-token",
        events: ["body", "ring", "policy:missing-token"],
      });
    });
  });
});

describe("the csrf policy's unboundPaths, beside bound paths and exclude", () => {
  const sessionVar = contextVar<string>("unbound-paths-test-session");
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  function sessionHeaders(session: string | undefined): Record<string, string> {
    return session === undefined ? {} : { "x-session": session };
  }

  function lawFirmApp(world: ReturnType<typeof csrfWorld>, unboundPaths: readonly string[] = ["/", "/api/contact"]): Forge {
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      onRefuse: world.onRefuse("policy"),
      session: sessionSlot(async (context, next) => {
        const session = context.request.headers.get("x-session");
        if (session !== null) sessionVar.set(context, session);
        return next();
      }),
      csrf: {
        ring: world.ring,
        subject: (c) => {
          world.events.push("subject");
          return sessionVar.getOptional(c);
        },
        unboundPaths,
        exclude: ["/email/confirm"],
      },
    });
    mapHandler(app, "GET", "/", async (c) => new Response(await mintCsrf(c, c.url.searchParams.get("for") ?? "")));
    for (const path of ["/api/contact", "/api/fica", "/auth/signout", "/email/confirm"]) {
      mapHandler(app, "POST", path, recordingHandler(`handled ${path}`, world.events));
    }
    return app;
  }

  async function mintOnHome(app: Forge, world: ReturnType<typeof csrfWorld>, target: string, session?: string): Promise<string> {
    const res = await app.request(`/?for=${encodeURIComponent(target)}`, { headers: sessionHeaders(session) });
    const token = await res.text();
    world.events.splice(0);
    return token;
  }

  async function post(app: Forge, world: ReturnType<typeof csrfWorld>, path: string, token: string | undefined, session?: string) {
    const res = await app.request(path, world.post({ ...sessionHeaders(session), ...(token === undefined ? {} : { "x-csrf-token": token }) }));
    return { status: res.status, body: await res.text(), events: world.events };
  }

  describe("minting on the unbound home page", () => {
    it("mints a path-only token for an unbound target without consulting the subject resolver", async () => {
      const world = csrfWorld(ring);
      const res = await lawFirmApp(world).request("/?for=/api/contact", { headers: sessionHeaders("session-a") });
      const token = await res.text();

      expect({
        status: res.status,
        events: world.events,
        pathOnly: await verifyCsrfToken(ring, token, "/api/contact"),
        underSession: await verifyCsrfToken(ring, token, "/api/contact", { subject: "session-a" }),
      }).toEqual({ status: 200, events: ["ring"], pathOnly: { ok: true }, underSession: { ok: false, error: "subject-mismatch" } });
    });

    it("mints a token for a bound target bound to the session, though the page itself is unbound", async () => {
      const world = csrfWorld(ring);
      const res = await lawFirmApp(world).request("/?for=/auth/signout", { headers: sessionHeaders("session-a") });
      const token = await res.text();

      expect({
        status: res.status,
        events: world.events,
        sameSession: await verifyCsrfToken(ring, token, "/auth/signout", { subject: "session-a" }),
        otherSession: await verifyCsrfToken(ring, token, "/auth/signout", { subject: "session-b" }),
      }).toEqual({ status: 200, events: ["ring", "subject"], sameSession: { ok: true }, otherSession: { ok: false, error: "subject-mismatch" } });
    });
  });

  describe("an unbound contact POST", () => {
    for (const { name, mintedUnder, postedUnder } of [
      { name: "with no session at mint or at verify", mintedUnder: undefined, postedUnder: undefined },
      { name: "under the session it was minted in", mintedUnder: "session-a", postedUnder: "session-a" },
      { name: "under a session other than the one it was minted in", mintedUnder: "session-a", postedUnder: "session-b" },
      { name: "minted with no session and posted under one", mintedUnder: undefined, postedUnder: "session-a" },
    ]) {
      it(`passes ${name}, never consulting the subject resolver`, async () => {
        const world = csrfWorld(ring);
        const app = lawFirmApp(world);
        const token = await mintOnHome(app, world, "/api/contact", mintedUnder);

        expect(await post(app, world, "/api/contact", token, postedUnder)).toEqual({
          status: 200,
          body: "handled /api/contact",
          events: ["ring", "handler"],
        });
      });
    }

    it("is refused without a token, unbound or not", async () => {
      const world = csrfWorld(ring);

      expect(await post(lawFirmApp(world), world, "/api/contact", undefined)).toEqual({
        status: 403,
        body: "policy refused: missing-token",
        events: ["body", "ring", "policy:missing-token"],
      });
    });
  });

  describe("a bound FICA POST", () => {
    it("passes with a token minted on the home page under the same session", async () => {
      const world = csrfWorld(ring);
      const app = lawFirmApp(world);
      const token = await mintOnHome(app, world, "/api/fica", "session-a");

      expect(await post(app, world, "/api/fica", token, "session-a")).toEqual({
        status: 200,
        body: "handled /api/fica",
        events: ["subject", "ring", "handler"],
      });
    });

    it("refuses a path-only token for its own path with subject-mismatch", async () => {
      const world = csrfWorld(ring);
      const token = await createCsrfToken(ring, "/api/fica");

      expect(await post(lawFirmApp(world), world, "/api/fica", token, "session-a")).toEqual({
        status: 403,
        body: "policy refused: subject-mismatch",
        events: ["subject", "ring", "policy:subject-mismatch"],
      });
    });

    it("refuses another session's token with subject-mismatch", async () => {
      const world = csrfWorld(ring);
      const app = lawFirmApp(world);
      const token = await mintOnHome(app, world, "/api/fica", "session-b");

      expect(await post(app, world, "/api/fica", token, "session-a")).toEqual({
        status: 403,
        body: "policy refused: subject-mismatch",
        events: ["subject", "ring", "policy:subject-mismatch"],
      });
    });

    it("refuses a POST with no session as unbound-subject, before reading the token", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const world = csrfWorld(ring);
        const token = await createCsrfToken(ring, "/api/fica");

        expect(await post(lawFirmApp(world), world, "/api/fica", token)).toEqual({
          status: 403,
          body: "policy refused: unbound-subject",
          events: ["subject", "policy:unbound-subject"],
        });
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("a sign-out token minted on the unbound home page", () => {
    it("verifies on a POST to the bound sign-out path under the same session", async () => {
      const world = csrfWorld(ring);
      const app = lawFirmApp(world);
      const token = await mintOnHome(app, world, "/auth/signout", "session-a");

      expect(await post(app, world, "/auth/signout", token, "session-a")).toEqual({
        status: 200,
        body: "handled /auth/signout",
        events: ["subject", "ring", "handler"],
      });
    });

    it("is refused on the sign-out path under another session", async () => {
      const world = csrfWorld(ring);
      const app = lawFirmApp(world);
      const token = await mintOnHome(app, world, "/auth/signout", "session-a");

      expect(await post(app, world, "/auth/signout", token, "session-b")).toEqual({
        status: 403,
        body: "policy refused: subject-mismatch",
        events: ["subject", "ring", "policy:subject-mismatch"],
      });
    });
  });

  it("lets a tokenless, sessionless POST to an excluded path reach the handler, touching neither ring nor resolver", async () => {
    const world = csrfWorld(ring);

    expect(await post(lawFirmApp(world), world, "/email/confirm", undefined)).toEqual({
      status: 200,
      body: "handled /email/confirm",
      events: ["handler"],
    });
  });

  it("throws at registration on a malformed unbound pattern, naming it", () => {
    expect(() => lawFirmApp(csrfWorld(ring), ["/", "/api/contact*"])).toThrow(/"\/api\/contact\*" is not a supported guard pattern/);
  });

  describe("the catch-all and the empty list", () => {
    it("leaves every target unbound under `*`, so a bound-looking path verifies a path-only token with no session", async () => {
      const world = csrfWorld(ring);
      const token = await createCsrfToken(ring, "/api/fica");

      expect(await post(lawFirmApp(world, ["*"]), world, "/api/fica", token)).toEqual({
        status: 200,
        body: "handled /api/fica",
        events: ["ring", "handler"],
      });
    });

    it("binds every target under an empty list, so a sessionless contact POST is refused as unbound-subject", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const world = csrfWorld(ring);
        const token = await createCsrfToken(ring, "/api/contact");

        expect(await post(lawFirmApp(world, []), world, "/api/contact", token)).toEqual({
          status: 403,
          body: "policy refused: unbound-subject",
          events: ["subject", "policy:unbound-subject"],
        });
      } finally {
        warn.mockRestore();
      }
    });
  });
});

describe("the app README's chain examples, with CSRF in the csrf slot", () => {
  const csrfRing = () => importKeyRing([CSRF_SECRET]);

  const shapes: { name: string; options: () => MiddlewareChainOptions }[] = [
    {
      name: "the options' own csrf slot",
      options: () => ({
        securityHeaders: {},
        session: sessionSlot(probe("session", [])),
        csrf: { ring: csrfRing, subject: false },
        guards: [{ paths: ["/api/*"], guards: [probe("guard", [])] }],
      }),
    },
    {
      name: "the root's csrf slot beside a contribution's session",
      options: () => ({
        securityHeaders: {},
        csrf: { ring: csrfRing, subject: false },
        contributions: [{ bindings: [] }, { session: sessionSlot(probe("session", [])) }],
      }),
    },
  ];

  for (const { name, options } of shapes) {
    it(`registers through ${name}, serves a GET and refuses a tokenless POST`, async () => {
      const app = new Forge();
      expect(() => applyMiddlewareChain(app, options())).not.toThrow();
      mapHandler(app, "GET", "/", () => new Response("ok"));
      mapHandler(app, "POST", "/", () => new Response("ok"));
      const tokenless = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Ada" };
      const [get, post] = [await app.request("/"), await app.request("/", tokenless)];
      expect({ get: get.status, post: post.status }).toEqual({ get: 200, post: 403 });
    });
  }

  type ReadmeEnv = { SITE_ORIGIN: string; RATE_LIMITER: RateLimit };
  const wiringExample = (trusted: boolean): MiddlewareChainOptions<ReadmeEnv> => ({
    ...DECLARES_LIMITER,
    requestId: true,
    ...(trusted ? { trustCfHeaders: true } : {}),
    logging: { channels: () => [consoleChannel()] },
    securityHeaders: { scriptSrc: ["'self'", NONCE] },
    session: sessionSlot(probe("session", [])),
    csrf: { ring: csrfRing, subject: "session" },
    guards: [{ paths: ["/api/*"], origin: { allowedOrigins: (c) => [c.env.SITE_ORIGIN] }, rateLimit: { binding: "RATE_LIMITER" } }],
  });

  it("registers the 'Wiring the middleware chain' example, and refuses it without trustCfHeaders", () => {
    expect(() => applyMiddlewareChain<ReadmeEnv>(new Forge(), wiringExample(true))).not.toThrow();
    expect(() => applyMiddlewareChain<ReadmeEnv>(new Forge(), wiringExample(false))).toThrow(
      "guard group `/api/*`: its `rateLimit` keys by client IP, which needs `trustCfHeaders: true` on `applyMiddlewareChain`, or a custom `key`.",
    );
  });
});

describe("applyMiddlewareChain — exclude", () => {
  /** Requests each path in turn, answering which of them `label` ran on. */
  async function ranOn(app: Forge, label: string, order: string[], paths: readonly string[]): Promise<string[]> {
    const hits: string[] = [];
    for (const path of paths) {
      order.length = 0;
      await app.request(path);
      if (order.includes(label)) hits.push(path);
    }
    return hits;
  }

  function routed(paths: readonly string[]): Forge {
    const app = new Forge();
    for (const path of paths) mapHandler(app, "GET", path, () => new Response("ok"));
    return app;
  }

  it("runs a global with `exclude` on `/` but not on `/api/x`", async () => {
    const order: string[] = [];
    const app = routed(["/", "/api/x"]);
    applyMiddlewareChain(app, { securityHeaders: {}, globals: [{ middleware: probe("global", order), exclude: ["/api/*"] }] });

    expect(await ranOn(app, "global", order, ["/", "/api/x"])).toEqual(["/"]);
  });

  it("runs a contribution's global with `exclude` on `/` but not on `/api/x`", async () => {
    const order: string[] = [];
    const app = routed(["/", "/api/x"]);
    applyMiddlewareChain(app, {
      securityHeaders: {},
      contributions: [{ globals: [{ middleware: probe("contributed", order), exclude: ["/api/*"] }] }],
    });

    expect(await ranOn(app, "contributed", order, ["/", "/api/x"])).toEqual(["/"]);
  });

  it("keeps bare and excluding globals in declaration order, dropping only the excluded entry", async () => {
    const order: string[] = [];
    const app = routed(["/", "/api/x"]);
    applyMiddlewareChain(app, {
      securityHeaders: {},
      globals: [probe("a", order), { middleware: probe("b", order), exclude: ["/api/*"] }, probe("c", order)],
    });

    await app.request("/");
    const root = order.splice(0);
    await app.request("/api/x");
    expect({ root, api: order }).toEqual({ root: ["a", "b", "c"], api: ["a", "c"] });
  });

  it("treats `/api/*` as the prefix and its descendants, leaving a longer sibling segment unexcluded", async () => {
    const order: string[] = [];
    const paths = ["/", "/api", "/api/x", "/api/x/y", "/apix"];
    const app = routed(paths);
    applyMiddlewareChain(app, { securityHeaders: {}, globals: [{ middleware: probe("global", order), exclude: ["/api/*"] }] });

    expect(await ranOn(app, "global", order, paths)).toEqual(["/", "/apix"]);
  });

  it("excludes exactly the URLs `app.use` matches for the same pattern", async () => {
    const order: string[] = [];
    const paths = ["/", "/api", "/api/", "/api/x", "/apix"];
    const app = routed(paths);
    app.use("/api/*", probe("use", order));
    applyMiddlewareChain(app, { securityHeaders: {}, globals: [{ middleware: probe("global", order), exclude: ["/api/*"] }] });

    const usedOn = await ranOn(app, "use", order, paths);
    const globalOn = await ranOn(app, "global", order, paths);
    expect({ usedOnPrefix: usedOn.includes("/api"), globalOn }).toEqual({
      usedOnPrefix: true,
      globalOn: paths.filter((path) => !usedOn.includes(path)),
    });
  });

  it("excludes an exact pattern without excluding the paths below it", async () => {
    const order: string[] = [];
    const paths = ["/health", "/health/deep", "/healthz"];
    const app = routed(paths);
    applyMiddlewareChain(app, { securityHeaders: {}, globals: [{ middleware: probe("global", order), exclude: ["/health"] }] });

    expect(await ranOn(app, "global", order, paths)).toEqual(["/health/deep", "/healthz"]);
  });

  it("skips every path any of several exclude patterns matches", async () => {
    const order: string[] = [];
    const paths = ["/", "/api/x", "/health", "/static/app.css", "/account"];
    const app = routed(paths);
    applyMiddlewareChain(app, {
      securityHeaders: {},
      globals: [{ middleware: probe("global", order), exclude: ["/api/*", "/health", "/static/*"] }],
    });

    expect(await ranOn(app, "global", order, paths)).toEqual(["/", "/account"]);
  });

  it("skips every path for an exclude holding the catch-all", async () => {
    const order: string[] = [];
    const paths = ["/", "/api/x"];
    const app = routed(paths);
    applyMiddlewareChain(app, { securityHeaders: {}, globals: [{ middleware: probe("global", order), exclude: ["*"] }] });

    expect(await ranOn(app, "global", order, paths)).toEqual([]);
  });

  it("runs a global whose `exclude` is empty on every path", async () => {
    const order: string[] = [];
    const paths = ["/", "/api/x"];
    const app = routed(paths);
    applyMiddlewareChain(app, { securityHeaders: {}, globals: [{ middleware: probe("global", order), exclude: [] }] });

    expect(await ranOn(app, "global", order, paths)).toEqual(paths);
  });

  it("runs a guard group whose `exclude` is empty on every path it matches", async () => {
    const order: string[] = [];
    const paths = ["/admin/users", "/admin/health"];
    const app = routed(paths);
    applyMiddlewareChain(app, { securityHeaders: {}, guards: [{ paths: ["/admin/*"], exclude: [], guards: [probe("guard", order)] }] });

    expect(await ranOn(app, "guard", order, paths)).toEqual(paths);
  });

  it("skips a guard group's shape and guards on a path its `exclude` matches, and runs both on the group's other paths", async () => {
    const order: string[] = [];
    const app = routed(["/admin/users", "/admin/health"]);
    applyMiddlewareChain(app, {
      securityHeaders: {},
      guards: [{ paths: ["/admin/*"], exclude: ["/admin/health"], shape: [probe("shape", order)], guards: [probe("guard", order)] }],
    });

    await app.request("/admin/health");
    const excluded = order.splice(0);
    await app.request("/admin/users");
    expect({ excluded, included: order }).toEqual({ excluded: [], included: ["shape", "guard"] });
  });

  it("skips one group's exclude without skipping another group covering the same path", async () => {
    const order: string[] = [];
    const app = routed(["/admin/health"]);
    applyMiddlewareChain(app, {
      securityHeaders: {},
      guards: [
        { paths: ["/admin/*"], exclude: ["/admin/health"], guards: [probe("admin", order)] },
        { paths: ["/admin/health"], guards: [probe("health", order)] },
      ],
    });

    await app.request("/admin/health");
    expect(order).toEqual(["health"]);
  });

  describe("a guard group's origin check and rate limit", () => {
    type CountedEnv = { LIMITER: RateLimit };

    function limitedApp(calls: string[]): { app: Forge<CountedEnv>; env: CountedEnv } {
      const app = new Forge<CountedEnv>();
      applyMiddlewareChain(app, {
        ...DECLARES_LIMITER,
        securityHeaders: {},
        trustCfHeaders: true,
        guards: [
          { paths: ["/api/*"], exclude: ["/api/webhook"], origin: { allowedOrigins: ["https://example.com"] }, rateLimit: { binding: "LIMITER" } },
        ],
      });
      for (const path of ["/api/webhook", "/api/save"]) mapHandler(app, "POST", path, () => new Response(`handled ${path}`));
      const env = {
        LIMITER: {
          limit: async () => {
            calls.push("limit");
            return { success: false };
          },
        },
      };
      return { app, env };
    }

    const headers = (origin: string) => ({ origin, "CF-Connecting-IP": "203.0.113.7" });

    it("lets a cross-origin POST through an excluded path without consulting the limiter", async () => {
      const calls: string[] = [];
      const { app, env } = limitedApp(calls);

      const res = await app.request("/api/webhook", { method: "POST", headers: headers("https://evil.example.net") }, env);

      expect({ status: res.status, body: await res.text(), calls }).toEqual({ status: 200, body: "handled /api/webhook", calls: [] });
    });

    it("still refuses a cross-origin POST on the group's other paths", async () => {
      const calls: string[] = [];
      const { app, env } = limitedApp(calls);

      const res = await app.request("/api/save", { method: "POST", headers: headers("https://evil.example.net") }, env);

      expect({ status: res.status, body: await res.text(), calls }).toEqual({ status: 403, body: "Forbidden", calls: [] });
    });

    it("still rate-limits a same-origin POST on the group's other paths", async () => {
      const calls: string[] = [];
      const { app, env } = limitedApp(calls);

      const res = await app.request("/api/save", { method: "POST", headers: headers("https://example.com") }, env);

      expect({ status: res.status, body: await res.text(), calls }).toEqual({
        status: 429,
        body: "Too many requests. Please try again later.",
        calls: ["limit"],
      });
    });
  });

  describe("an excluded request under an armed csrf policy", () => {
    let ring: KeyRing;
    beforeAll(async () => {
      ring = await importKeyRing([CSRF_SECRET]);
    });

    function excludedApp(world: ReturnType<typeof csrfWorld>): Forge<LimitedEnv> {
      const app = new Forge<LimitedEnv>();
      applyMiddlewareChain(app, {
        securityHeaders: {},
        onRefuse: world.onRefuse("policy"),
        csrf: { paths: ["/admin/*"], ring: world.ring, subject: false },
        guards: [{ paths: ["/admin/*"], exclude: ["/admin/hook"], guards: [probe("guard", world.events)] }],
      });
      mapHandler(app, "POST", "/admin/hook", recordingHandler("hooked", world.events));
      return app;
    }

    it("refuses a tokenless POST in the router's final stage, with the group's guard skipped", async () => {
      const world = csrfWorld(ring);

      const res = await excludedApp(world).request("/admin/hook", world.post(SAME_ORIGIN), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 403,
        body: "policy refused: missing-token",
        events: ["body", "ring", "policy:missing-token"],
      });
    });

    it("passes a POST carrying a valid token, with the group's guard skipped", async () => {
      const world = csrfWorld(ring);
      const token = await createCsrfToken(ring, "/admin/hook");

      const res = await excludedApp(world).request("/admin/hook", world.post({ ...SAME_ORIGIN, "x-csrf-token": token }), world.env());

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 200,
        body: "hooked",
        events: ["ring", "handler"],
      });
    });
  });

  describe("a malformed exclude or unboundPaths pattern", () => {
    const placements: { from: string; place: (order: string[]) => Partial<MiddlewareChainOptions> }[] = [
      { from: "a globals entry", place: (order) => ({ globals: [{ middleware: probe("global", order), exclude: ["/ok/*", "/api*"] }] }) },
      {
        from: "a contribution's globals entry",
        place: (order) => ({ contributions: [{ globals: [{ middleware: probe("global", order), exclude: ["/api*"] }] }] }),
      },
      { from: "a guard group", place: (order) => ({ guards: [{ paths: ["/"], exclude: ["/api*"], guards: [probe("guard", order)] }] }) },
      {
        from: "a contributed guard group",
        place: (order) => ({ contributions: [{ guards: [{ paths: ["/"], exclude: ["*", "/api*"], guards: [probe("guard", order)] }] }] }),
      },
      { from: "the csrf policy", place: () => ({ csrf: { ring: () => importKeyRing([CSRF_SECRET]), subject: false, exclude: ["/api*"] } }) },
      {
        from: "the csrf policy's unboundPaths",
        place: () => ({ csrf: { ring: () => importKeyRing([CSRF_SECRET]), subject: false, unboundPaths: ["/", "/api*"] } }),
      },
    ];

    for (const { from, place } of placements) {
      it(`in ${from} throws naming the pattern, and registers nothing`, async () => {
        const order: string[] = [];
        const app = new Forge();

        expect(() => applyMiddlewareChain(app, { session: sessionSlot(probe("session", order)), ...place(order), securityHeaders: {} })).toThrow(
          /"\/api\*" is not a supported guard pattern/,
        );
        mapHandler(app, "GET", "/", () => {
          order.push("handler");
          return new Response("ok");
        });

        const res = await app.request("/");
        expect({ status: res.status, nosniff: res.headers.get("x-content-type-options"), order }).toEqual({
          status: 200,
          nosniff: null,
          order: ["handler"],
        });
      });
    }

    it("in a group passed to buildGuardChain throws naming the pattern", () => {
      expect(() => buildGuardChain({ paths: ["/"], exclude: ["/api*"] })).toThrow(/"\/api\*" is not a supported guard pattern/);
    });
  });
});

describe("buildGuardChain — exclude", () => {
  function mounted(group: MiddlewareGuardGroup): Forge {
    const app = new Forge();
    app.use("/admin/*", ...buildGuardChain(group));
    for (const path of ["/admin/users", "/admin/health"]) mapHandler(app, "POST", path, () => new Response(`handled ${path}`));
    return app;
  }

  it("skips the whole chain on a path its `exclude` matches", async () => {
    const order: string[] = [];
    const app = mounted({
      paths: ["/admin/*"],
      exclude: ["/admin/health"],
      origin: { allowedOrigins: ["https://example.com"] },
      guards: [probe("guard", order)],
    });

    const res = await app.request("/admin/health", { method: "POST", headers: { origin: "https://evil.example.net" } });

    expect({ status: res.status, body: await res.text(), order }).toEqual({ status: 200, body: "handled /admin/health", order: [] });
  });

  it("runs the whole chain on the group's other paths", async () => {
    const order: string[] = [];
    const group = {
      paths: ["/admin/*"],
      exclude: ["/admin/health"],
      origin: { allowedOrigins: ["https://example.com"] },
      guards: [probe("guard", order)],
    };

    const refused = await mounted(group).request("/admin/users", { method: "POST", headers: { origin: "https://evil.example.net" } });
    const allowed = await mounted(group).request("/admin/users", { method: "POST", headers: { origin: "https://example.com" } });

    expect({ refused: [refused.status, await refused.text()], allowed: [allowed.status, await allowed.text()], order }).toEqual({
      refused: [403, "Forbidden"],
      allowed: [200, "handled /admin/users"],
      order: ["guard"],
    });
  });
});

describe("applyMiddlewareChain — a malformed paths pattern", () => {
  const placements: { from: string; place: (order: string[]) => Partial<MiddlewareChainOptions> }[] = [
    {
      from: "a guard group",
      place: (order) => ({
        guards: [
          { paths: ["/ok/*"], guards: [probe("ok", order)] },
          { paths: ["/bad*"], guards: [probe("bad", order)] },
        ],
      }),
    },
    {
      from: "a contributed guard group",
      place: (order) => ({
        guards: [{ paths: ["/ok/*"], guards: [probe("ok", order)] }],
        contributions: [{ guards: [{ paths: ["/bad*"], guards: [probe("bad", order)] }] }],
      }),
    },
    { from: "the csrf policy", place: () => ({ csrf: { paths: ["/bad*"], ring: () => importKeyRing([CSRF_SECRET]), subject: false } }) },
  ];

  for (const { from, place } of placements) {
    it(`in ${from} throws naming the pattern before any app.use`, () => {
      const order: string[] = [];
      const app = new Forge();
      const use = spyOn(app, "use");

      expect(() => applyMiddlewareChain(app, { session: sessionSlot(probe("session", order)), ...place(order), securityHeaders: {} })).toThrow(
        /"\/bad\*" is not a supported guard pattern/,
      );
      expect(use).toHaveBeenCalledTimes(0);
    });
  }
});

describe("the chain's onRefuse and a guard group's own", () => {
  let ring: KeyRing;
  let consoleLog: ReturnType<typeof spyOn<Console, "log">>;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });
  beforeEach(() => {
    consoleLog = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleLog.mockRestore();
  });

  function hooks() {
    const answered: Array<{ by: string; refusal: Refusal }> = [];
    const hook =
      (by: string): RefuseHook<LimitedEnv> =>
      (_c, refusal) => {
        answered.push({ by, refusal });
        return new Response(by, { status: refusal.status });
      };
    return { answered, hook };
  }

  function staffApp(group: Omit<MiddlewareGuardGroup<LimitedEnv>, "paths">) {
    const world = csrfWorld(ring);
    const { answered, hook } = hooks();
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      onRefuse: hook("chain"),
      csrf: { ring: world.ring, subject: false },
      guards: [{ paths: ["/staff/*"], ...group }],
    });
    mapHandler(app, "POST", "/staff/signout", recordingHandler("signed out", world.events));
    mapHandler(app, "POST", "/contact", recordingHandler("sent", world.events));
    return { app, world, answered, hook };
  }

  it("answers a tokenless POST on the group's paths with the group's hook, and one elsewhere with the chain's at the final stage", async () => {
    const own = hooks();
    const { app, world, answered } = staffApp({ origin: { allowedOrigins: ["http://localhost"] }, onRefuse: own.hook("staff") });

    const staff = await app.request("/staff/signout", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env());
    const contact = await app.request("/contact", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env());

    expect({
      staff: { status: staff.status, body: await staff.text() },
      contact: { status: contact.status, body: await contact.text() },
      own: own.answered,
      chain: answered,
      handlerRan: world.events.includes("handler"),
    }).toEqual({
      staff: { status: 403, body: "staff" },
      contact: { status: 403, body: "chain" },
      own: [{ by: "staff", refusal: { guard: "csrf", status: 403, reason: "missing-token" } }],
      chain: [{ by: "chain", refusal: { guard: "csrf", status: 403, reason: "missing-token" } }],
      handlerRan: false,
    });
  });

  it("answers the group's origin and rate-limit refusals with the group's hook", async () => {
    const own = hooks();
    const { app, world, answered } = staffApp({
      origin: { allowedOrigins: ["http://localhost"] },
      rateLimit: { binding: "LIMITER", key: () => "client-1" },
      onRefuse: own.hook("staff"),
    });

    const crossSite = await app.request("/staff/signout", world.post({ ...CROSS_ORIGIN, "sec-fetch-site": "cross-site" }), world.env());
    const spent = await app.request("/staff/signout", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env(false));

    expect({ statuses: [crossSite.status, spent.status], own: own.answered, chain: answered }).toEqual({
      statuses: [403, 429],
      own: [
        { by: "staff", refusal: { guard: "origin", status: 403, reason: "cross-site" } },
        { by: "staff", refusal: { guard: "rate-limit", status: 429, retryAfter: DECLARES_LIMITER.rateLimits.LIMITER.period } },
      ],
      chain: [],
    });
  });

  it("answers a group's origin, rate-limit and CSRF refusals with the chain's hook when the group declares none", async () => {
    const { app, world, answered } = staffApp({
      origin: { allowedOrigins: ["http://localhost"] },
      rateLimit: { binding: "LIMITER", key: () => "client-1" },
    });

    await app.request("/staff/signout", world.post({ ...CROSS_ORIGIN, "sec-fetch-site": "cross-site" }), world.env());
    await app.request("/staff/signout", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env(false));
    await app.request("/staff/signout", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env());

    expect(answered).toEqual([
      { by: "chain", refusal: { guard: "origin", status: 403, reason: "cross-site" } },
      { by: "chain", refusal: { guard: "rate-limit", status: 429, retryAfter: DECLARES_LIMITER.rateLimits.LIMITER.period } },
      { by: "chain", refusal: { guard: "csrf", status: 403, reason: "missing-token" } },
    ]);
  });

  it("keeps a group stage's own hook over the group's", async () => {
    const group = hooks();
    const stage = hooks();
    const { app, world, answered } = staffApp({
      rateLimit: { binding: "LIMITER", key: () => "client-1", onRefuse: stage.hook("stage") },
      onRefuse: group.hook("staff"),
    });

    const res = await app.request("/staff/signout", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env(false));

    expect({ status: res.status, body: await res.text(), stage: stage.answered.length, group: group.answered, chain: answered }).toEqual({
      status: 429,
      body: "stage",
      stage: 1,
      group: [],
      chain: [],
    });
  });

  it("asks a declining hook that is both the group's and the chain's once for a stage refusal its own hook declines, the answer unchanged", async () => {
    const world = csrfWorld(ring);
    const asked: Refusal[] = [];
    const both: RefuseHook<LimitedEnv> = (_c, refusal) => {
      asked.push(refusal);
      return undefined;
    };
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      onRefuse: both,
      csrf: { ring: world.ring, subject: false },
      guards: [{ paths: ["/staff/*"], rateLimit: { binding: "LIMITER", key: () => "client-1", onRefuse: () => undefined }, onRefuse: both }],
    });
    mapHandler(app, "POST", "/staff/signout", recordingHandler("signed out", world.events));

    const res = await app.request("/staff/signout", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env(false));

    expect({ status: res.status, body: await res.text(), asked: asked.map((refusal) => refusal.guard) }).toEqual({
      status: 429,
      body: "Too many requests. Please try again later.",
      asked: ["rate-limit"],
    });
  });

  it("asks an answering hook that is both the group's and the chain's once for a stage refusal its own hook declines, answering with it", async () => {
    const world = csrfWorld(ring);
    const { answered, hook } = hooks();
    const both = hook("both");
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      onRefuse: both,
      csrf: { ring: world.ring, subject: false },
      guards: [{ paths: ["/staff/*"], rateLimit: { binding: "LIMITER", key: () => "client-1", onRefuse: () => undefined }, onRefuse: both }],
    });
    mapHandler(app, "POST", "/staff/signout", recordingHandler("signed out", world.events));

    const res = await app.request("/staff/signout", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env(false));

    expect({ status: res.status, body: await res.text(), answered }).toEqual({
      status: 429,
      body: "both",
      answered: [{ by: "both", refusal: { guard: "rate-limit", status: 429, retryAfter: DECLARES_LIMITER.rateLimits.LIMITER.period } }],
    });
  });

  it("asks a declining hook that is both the group's and the chain's once for a CSRF refusal, the answer unchanged", async () => {
    const world = csrfWorld(ring);
    const asked: Refusal[] = [];
    const both: RefuseHook<LimitedEnv> = (_c, refusal) => {
      asked.push(refusal);
      return undefined;
    };
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      onRefuse: both,
      csrf: { ring: world.ring, subject: false },
      guards: [{ paths: ["/staff/*"], origin: { allowedOrigins: ["http://localhost"] }, onRefuse: both }],
    });
    mapHandler(app, "POST", "/staff/signout", recordingHandler("signed out", world.events));

    const res = await app.request("/staff/signout", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env());

    expect({
      status: res.status,
      body: await res.text(),
      asked: asked.map((refusal) => ("reason" in refusal ? refusal.reason : refusal.guard)),
    }).toEqual({ status: 403, body: "Forbidden", asked: ["missing-token"] });
  });

  it("leaves a group override with no verify stage unused, so its paths' CSRF refusal is the chain's", async () => {
    const own = hooks();
    const { app, world, answered } = staffApp({ shape: [probe("shape", [])], onRefuse: own.hook("staff") });

    const res = await app.request("/staff/signout", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env());

    expect({ status: res.status, body: await res.text(), own: own.answered, chain: answered }).toEqual({
      status: 403,
      body: "chain",
      own: [],
      chain: [{ by: "chain", refusal: { guard: "csrf", status: 403, reason: "missing-token" } }],
    });
  });

  it("answers a route-mounted rateLimit with no hook of its own through the chain's", async () => {
    const { answered, hook } = hooks();
    const reached: string[] = [];
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, { securityHeaders: {}, onRefuse: hook("chain") });
    mapHandler(app, "POST", "/limited", {
      middleware: [rateLimit<LimitedEnv>({ binding: "LIMITER", key: () => "client-1" })],
      handler: recordingHandler("ok", reached),
    });

    const res = await app.request("/limited", { method: "POST" }, { LIMITER: { limit: async () => ({ success: false }) } });

    expect({ status: res.status, body: await res.text(), answered, reached }).toEqual({
      status: 429,
      body: "chain",
      answered: [{ by: "chain", refusal: { guard: "rate-limit", status: 429 } }],
      reached: [],
    });
  });

  it("answers with forge's plain-text default where neither chain nor group declares a hook", async () => {
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      guards: [{ paths: ["/staff/*"], rateLimit: { binding: "LIMITER", key: () => "client-1" } }],
    });
    mapHandler(app, "POST", "/staff/signout", () => new Response("signed out"));

    const res = await app.request("/staff/signout", { method: "POST" }, { LIMITER: { limit: async () => ({ success: false }) } });

    expect({ status: res.status, body: await res.text() }).toEqual({ status: 429, body: "Too many requests. Please try again later." });
  });

  it("answers one group's htmx CSRF refusal with refuseAsFragment and another's with refuseAsProblem on the same chain, neither writing the reason", async () => {
    const world = csrfWorld(ring);
    const answered: Array<{ by: string; refusal: Refusal }> = [];
    const recorded =
      (by: string, hook: RefuseHook<LimitedEnv>): RefuseHook<LimitedEnv> =>
      (c, refusal) => {
        answered.push({ by, refusal });
        return hook(c, refusal);
      };
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, {
      securityHeaders: {},
      csrf: { ring: world.ring, subject: false },
      guards: [
        {
          paths: ["/staff/*"],
          origin: { allowedOrigins: ["http://localhost"] },
          onRefuse: recorded(
            "fragment",
            refuseAsFragment({
              target: "#staff-errors",
              render: () => ({ message: "Your form expired.", panel: jsx("p", { children: "Reload the page and send it again." }) }),
            }),
          ),
        },
        { paths: ["/api/*"], origin: { allowedOrigins: ["http://localhost"] }, onRefuse: recorded("problem", refuseAsProblem()) },
      ],
    });
    mapHandler(app, "POST", "/staff/signout", recordingHandler("signed out", world.events));
    mapHandler(app, "POST", "/api/contacts", recordingHandler("created", world.events));

    const htmx = await app.request(
      "/staff/signout",
      world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin", "HX-Request": "true" }),
      world.env(),
    );
    const json = await app.request("/api/contacts", world.post({ ...SAME_ORIGIN, "sec-fetch-site": "same-origin" }), world.env());
    const htmxBody = await htmx.text();
    const jsonBody = await json.text();

    expect({
      htmx: {
        status: htmx.status,
        contentType: htmx.headers.get("content-type"),
        retarget: htmx.headers.get("HX-Retarget"),
        reswap: htmx.headers.get("HX-Reswap"),
        body: htmxBody,
      },
      json: { status: json.status, contentType: json.headers.get("content-type"), body: JSON.parse(jsonBody) },
      answered,
      reasonWritten: [htmxBody, jsonBody].some((body) => body.includes("missing-token")),
      handlerRan: world.events.includes("handler"),
    }).toEqual({
      htmx: {
        status: 403,
        contentType: "text/html; charset=utf-8",
        retarget: "#staff-errors",
        reswap: "innerHTML",
        body: `<div ${ANNOUNCE_FAILURE_ATTR}="Your form expired."><p>Reload the page and send it again.</p></div>`,
      },
      json: { status: 403, contentType: "application/problem+json; charset=utf-8", body: { type: "about:blank", title: "Forbidden", status: 403 } },
      answered: [
        { by: "fragment", refusal: { guard: "csrf", status: 403, reason: "missing-token" } },
        { by: "problem", refusal: { guard: "csrf", status: 403, reason: "missing-token" } },
      ],
      reasonWritten: false,
      handlerRan: false,
    });
  });
});

describe("a CSRF refusal on a path two guard groups cover", () => {
  let ring: KeyRing;
  let consoleLog: ReturnType<typeof spyOn<Console, "log">>;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });
  beforeEach(() => {
    consoleLog = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleLog.mockRestore();
  });

  const SAME_SITE_POST = { ...SAME_ORIGIN, "sec-fetch-site": "same-origin" };
  const ORIGIN_CHECK = { origin: { allowedOrigins: ["http://localhost"] } };
  const MISSING_TOKEN = { guard: "csrf", status: 403, reason: "missing-token" };

  function overlapApp(groups: (hook: (by: string) => RefuseHook<LimitedEnv>) => MiddlewareGuardGroup<LimitedEnv>[]) {
    const world = csrfWorld(ring);
    const answered: Array<{ by: string; refusal: Refusal }> = [];
    const hook =
      (by: string): RefuseHook<LimitedEnv> =>
      (_c, refusal) => {
        answered.push({ by, refusal });
        return new Response(by, { status: refusal.status });
      };
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, {
      securityHeaders: {},
      onRefuse: hook("chain"),
      csrf: { ring: world.ring, subject: false },
      guards: groups(hook),
    });
    app.use("/api/contact", probe("late", world.events));
    mapHandler(app, "POST", "/api/contact", recordingHandler("sent", world.events));
    return { app, world, answered };
  }

  const cases: {
    name: string;
    groups: (hook: (by: string) => RefuseHook<LimitedEnv>) => MiddlewareGuardGroup<LimitedEnv>[];
    expected: { body: string; events: string[] };
  }[] = [
    {
      name: "answers with the later group's hook when both groups verify and declare one, checking the token once",
      groups: (hook) => [
        { paths: ["/api/*"], ...ORIGIN_CHECK, onRefuse: hook("api") },
        { paths: ["/api/contact"], ...ORIGIN_CHECK, onRefuse: hook("contact") },
      ],
      expected: { body: "contact", events: ["body", "ring"] },
    },
    {
      name: "answers with the later group's hook when the earlier verifying group declares none",
      groups: (hook) => [
        { paths: ["/api/*"], ...ORIGIN_CHECK },
        { paths: ["/api/contact"], ...ORIGIN_CHECK, onRefuse: hook("contact") },
      ],
      expected: { body: "contact", events: ["body", "ring"] },
    },
    {
      name: "answers with the later group's hook when the later group verifies only through guards",
      groups: (hook) => [
        { paths: ["/api/*"], ...ORIGIN_CHECK, onRefuse: hook("api") },
        { paths: ["/api/contact"], guards: [probe("guard", [])], onRefuse: hook("contact") },
      ],
      expected: { body: "contact", events: ["body", "ring"] },
    },
    {
      name: "keeps the earlier group's hook when the later group excludes the path",
      groups: (hook) => [
        { paths: ["/api/*"], ...ORIGIN_CHECK, onRefuse: hook("api") },
        { paths: ["/api/*"], exclude: ["/api/contact"], ...ORIGIN_CHECK, onRefuse: hook("contact") },
      ],
      expected: { body: "api", events: ["body", "ring"] },
    },
    {
      name: "keeps the earlier group's hook when the later group is shape-only",
      groups: (hook) => [
        { paths: ["/api/*"], ...ORIGIN_CHECK, onRefuse: hook("api") },
        { paths: ["/api/contact"], shape: [probe("shape", [])], onRefuse: hook("contact") },
      ],
      expected: { body: "api", events: ["body", "ring"] },
    },
    {
      name: "keeps the earlier group's hook when the later verifying group declares none",
      groups: (hook) => [
        { paths: ["/api/*"], ...ORIGIN_CHECK, onRefuse: hook("api") },
        { paths: ["/api/contact"], ...ORIGIN_CHECK },
      ],
      expected: { body: "api", events: ["body", "ring"] },
    },
    {
      name: "answers with the chain's hook at the router's final stage when neither group verifies",
      groups: (hook) => [
        { paths: ["/api/*"], shape: [probe("shape", [])], onRefuse: hook("api") },
        { paths: ["/api/contact"], shape: [probe("shape", [])], onRefuse: hook("contact") },
      ],
      expected: { body: "chain", events: ["late", "body", "ring"] },
    },
    {
      name: "answers with the chain's hook at the router's final stage when the only verifying group excludes the path",
      groups: (hook) => [
        { paths: ["/api/*"], exclude: ["/api/contact"], ...ORIGIN_CHECK, onRefuse: hook("api") },
        { paths: ["/api/contact"], shape: [probe("shape", [])], onRefuse: hook("contact") },
      ],
      expected: { body: "chain", events: ["late", "body", "ring"] },
    },
  ];

  for (const { name, groups, expected } of cases) {
    it(name, async () => {
      const { app, world, answered } = overlapApp(groups);

      const res = await app.request("/api/contact", world.post(SAME_SITE_POST), world.env());

      expect({ status: res.status, body: await res.text(), answered, events: world.events }).toEqual({
        status: 403,
        body: expected.body,
        answered: [{ by: expected.body, refusal: MISSING_TOKEN }],
        events: expected.events,
      });
    });
  }

  it("answers a token minted for another path with the later group's hook, carrying the verifier's reason", async () => {
    const { app, world, answered } = overlapApp((hook) => [
      { paths: ["/api/*"], ...ORIGIN_CHECK, onRefuse: hook("api") },
      { paths: ["/api/contact"], ...ORIGIN_CHECK, onRefuse: hook("contact") },
    ]);
    const token = await createCsrfToken(ring, "/api/other");
    const verdict = await verifyCsrfToken(ring, token, "/api/contact");

    const res = await app.request("/api/contact", world.post({ ...SAME_SITE_POST, "x-csrf-token": token }), world.env());

    expect({ status: res.status, body: await res.text(), answered, events: world.events }).toEqual({
      status: 403,
      body: "contact",
      answered: [{ by: "contact", refusal: { guard: "csrf", status: 403, reason: verdict.ok ? "unexpected-pass" : verdict.error } }],
      events: ["ring"],
    });
  });

  it("passes a valid token after one check, reaching the late middleware and the handler", async () => {
    const { app, world, answered } = overlapApp((hook) => [
      { paths: ["/api/*"], ...ORIGIN_CHECK, onRefuse: hook("api") },
      { paths: ["/api/contact"], ...ORIGIN_CHECK, onRefuse: hook("contact") },
    ]);
    const token = await createCsrfToken(ring, "/api/contact");

    const res = await app.request("/api/contact", world.post({ ...SAME_SITE_POST, "x-csrf-token": token }), world.env());

    expect({ status: res.status, body: await res.text(), answered, events: world.events }).toEqual({
      status: 200,
      body: "sent",
      answered: [],
      events: ["ring", "late", "handler"],
    });
  });

  it("answers a cross-origin POST with the earlier group's hook, since its origin check refuses before the later group's runs", async () => {
    const { app, world, answered } = overlapApp((hook) => [
      { paths: ["/api/*"], ...ORIGIN_CHECK, onRefuse: hook("api") },
      { paths: ["/api/contact"], ...ORIGIN_CHECK, onRefuse: hook("contact") },
    ]);

    const res = await app.request("/api/contact", world.post({ ...CROSS_ORIGIN, "sec-fetch-site": "cross-site" }), world.env());

    expect({ status: res.status, body: await res.text(), answered, events: world.events }).toEqual({
      status: 403,
      body: "api",
      answered: [{ by: "api", refusal: { guard: "origin", status: 403, reason: "cross-site" } }],
      events: [],
    });
  });
});

describe("applyMiddlewareChain — the csrf policy's maxAgeMs", () => {
  const HOUR = 3_600_000;
  const MINTED_AT = 1_790_000_000_000;
  let ring: KeyRing;

  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  afterEach(() => {
    setSystemTime();
  });

  async function tokenAged(ageMs: number): Promise<string> {
    setSystemTime(new Date(MINTED_AT));
    const token = await createCsrfToken(ring, "/save");
    setSystemTime(new Date(MINTED_AT + ageMs));
    return token;
  }

  function lifetimeApp(policy: { maxAgeMs?: number } = {}) {
    const refusals: Refusal[] = [];
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      onRefuse: (_context, refusal) => {
        refusals.push(refusal);
        return new Response(`refused: ${"reason" in refusal ? refusal.reason : refusal.guard}`, { status: refusal.status });
      },
      csrf: { ring: () => ring, subject: false, ...policy },
    });
    mapHandler(app, "POST", "/save", () => new Response("saved"));
    return { app, refusals };
  }

  const ADMITTED = { status: 200, body: "saved", refusals: [] };
  const REFUSED_EXPIRED = { status: 403, body: "refused: expired", refusals: [{ guard: "csrf", status: 403, reason: "expired" }] };

  const lifetimes: Array<{ name: string; ageMs: number; policy?: { maxAgeMs: number }; expected: unknown }> = [
    { name: "admits a token aged 20 hours at the default", ageMs: 20 * HOUR, expected: ADMITTED },
    { name: "hands a token aged 24 hours and 1 ms to the chain's hook as expired at the default", ageMs: 24 * HOUR + 1, expected: REFUSED_EXPIRED },
    {
      name: "hands a token aged 2 hours to the chain's hook as expired under a maxAgeMs of 1 hour",
      ageMs: 2 * HOUR,
      policy: { maxAgeMs: HOUR },
      expected: REFUSED_EXPIRED,
    },
    { name: "admits a token aged 30 hours under a maxAgeMs of 48 hours", ageMs: 30 * HOUR, policy: { maxAgeMs: 48 * HOUR }, expected: ADMITTED },
  ];

  for (const { name, ageMs, policy, expected } of lifetimes) {
    it(name, async () => {
      const { app, refusals } = lifetimeApp(policy);
      const token = await tokenAged(ageMs);
      const res = await app.request("/save", { method: "POST", headers: { ...SAME_ORIGIN, "x-csrf-token": token } });
      expect({ status: res.status, body: await res.text(), refusals }).toEqual(expected);
    });
  }

  const FLOOR = "below the 1-millisecond floor — a token that never verifies refuses every mutation.";
  const knobRefusals: Array<{ maxAgeMs: number; message: string }> = [
    { maxAgeMs: 0, message: `applyMiddlewareChain: maxAgeMs is 0, ${FLOOR}` },
    { maxAgeMs: -1, message: `applyMiddlewareChain: maxAgeMs is -1, ${FLOOR}` },
    { maxAgeMs: 1.5, message: "applyMiddlewareChain: maxAgeMs is 1.5, which is not a whole number." },
  ];
  const placements: Array<{ from: string; place: (maxAgeMs: number) => Partial<MiddlewareChainOptions> }> = [
    { from: "the options' csrf policy", place: (maxAgeMs) => ({ csrf: { ring: () => ring, subject: false, maxAgeMs } }) },
  ];

  for (const { from, place } of placements) {
    for (const { maxAgeMs, message } of knobRefusals) {
      it(`throws on a maxAgeMs of ${maxAgeMs} in ${from}, registering nothing`, async () => {
        const app = new Forge();
        expect(() => applyMiddlewareChain(app, { securityHeaders: {}, ...place(maxAgeMs) })).toThrow(new Error(message));
        mapHandler(app, "POST", "/save", () => new Response("saved"));

        const res = await app.request("/save", { method: "POST", headers: SAME_ORIGIN });
        expect({ status: res.status, body: await res.text(), nosniff: res.headers.get("x-content-type-options") }).toEqual({
          status: 200,
          body: "saved",
          nosniff: null,
        });
      });
    }
  }
});

describe("applyMiddlewareChain — the csrf policy's ring wrapped in createKeyRingResolver", () => {
  interface AppEnv {
    readonly CSRF_SECRET: string;
  }
  const UNWRAP = "applyMiddlewareChain: pass the `(env) => importKeyRing(…)` function itself, not `createKeyRingResolver(…)`";

  it("is refused at bun check whatever Bindings it was made under, and throws at construction", () => {
    const inferred = () =>
      applyMiddlewareChain(new Forge(), {
        securityHeaders: {},
        csrf: {
          // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
          ring: createKeyRingResolver(() => importKeyRing([CSRF_SECRET])),
          subject: false,
        },
      });
    const typed = () =>
      applyMiddlewareChain(new Forge<AppEnv>(), {
        securityHeaders: {},
        csrf: {
          // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
          ring: createKeyRingResolver<AppEnv>((env) => importKeyRing([env.CSRF_SECRET])),
          subject: false,
        },
      });
    expect(inferred).toThrow(new Error(UNWRAP));
    expect(typed).toThrow(new Error(UNWRAP));
  });

  it("cast past the type, throws at construction naming applyMiddlewareChain and the fix", () => {
    const ring = createKeyRingResolver<AppEnv>((env) => importKeyRing([env.CSRF_SECRET])) as unknown as KeyRingResolver<AppEnv>;
    expect(() => applyMiddlewareChain(new Forge<AppEnv>(), { securityHeaders: {}, csrf: { ring, subject: false } })).toThrow(new Error(UNWRAP));
  });

  it("leaves a plain env resolver accepted and handed the env", async () => {
    const app = new Forge<AppEnv>();
    applyMiddlewareChain(app, { securityHeaders: {}, csrf: { ring: (env: AppEnv) => importKeyRing([env.CSRF_SECRET]), subject: false } });
    mapHandler(app, "GET", "/page", async (c) => new Response(await mintCsrf(c, "/save")));
    const token = await (await app.request("/page", {}, { CSRF_SECRET })).text();
    expect(await verifyCsrfToken(await importKeyRing([CSRF_SECRET]), token, "/save")).toEqual({ ok: true });
  });
});

describe("applyMiddlewareChain — a csrf ring still written against the request context", () => {
  const HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";
  // oxlint-disable-next-line typescript/no-explicit-any -- a 0.7.7 resolver typed against the context it is no longer handed
  type ContextResolver = (c: any) => Promise<KeyRing>;
  const unconverted: { name: string; ring: ContextResolver }[] = [
    { name: "c.env", ring: (c) => importKeyRing([c.env.CSRF_SECRET]) },
    { name: "c.get", ring: (c) => importKeyRing([c.get("CSRF_SECRET")]) },
  ];

  for (const { name, ring } of unconverted) {
    it(`answers the first request that mints with the rewrite, for a ring reading ${name}`, async () => {
      const app = new Forge<{ CSRF_SECRET: string }>();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      applyMiddlewareChain(app, { securityHeaders: {}, csrf: { ring, subject: false } });
      mapHandler(app, "GET", "/page", async (c) => new Response(await mintCsrf(c, "/save")));
      const res = await app.request("/page", {}, { CSRF_SECRET });
      expect({ status: res.status, body: await res.text() }).toEqual({ status: 500, body: HANDED_ENV });
    });
  }
});

describe("applyMiddlewareChain — a rate limit keyed by client IP under the chain's declared trust", () => {
  const CLIENT_IP = "203.0.113.7";

  type Mounting = {
    name: string;
    guards?: MiddlewareGuardGroup<LimitedEnv>[];
    mountAfterChain: (app: Forge<LimitedEnv>, reached: string[]) => void;
  };
  const routeLevel: Mounting[] = [
    {
      name: "a rateLimit mounted by app.use after the chain",
      mountAfterChain: (app, reached) => {
        app.use("/limited", rateLimit<LimitedEnv>({ binding: "LIMITER" }));
        mapHandler(app, "POST", "/limited", recordingHandler("ok", reached));
      },
    },
    {
      name: "a rateLimit in the route's own middleware",
      mountAfterChain: (app, reached) => {
        mapHandler(app, "POST", "/limited", {
          middleware: [rateLimit<LimitedEnv>({ binding: "LIMITER" })],
          handler: recordingHandler("ok", reached),
        });
      },
    },
  ];
  const groupLevel: Mounting = {
    name: "a guard group's rateLimit",
    guards: [{ paths: ["/limited"], rateLimit: { binding: "LIMITER" } }],
    mountAfterChain: (app, reached) => mapHandler(app, "POST", "/limited", recordingHandler("ok", reached)),
  };

  function limitedApp(mounting: Mounting, trusted: boolean) {
    const answered: Refusal[] = [];
    const records: LogRecord[] = [];
    const keys: string[] = [];
    const reached: string[] = [];
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, {
      ...DECLARES_LIMITER,
      ...(trusted ? { trustCfHeaders: true } : {}),
      securityHeaders: {},
      guards: mounting.guards ?? [],
      logging: { channels: () => [{ write: (record) => void records.push(record) }] },
      onRefuse: (_c, refusal) => (answered.push(refusal), new Response("chain refused", { status: refusal.status })),
    });
    mounting.mountAfterChain(app, reached);
    const env: LimitedEnv = { LIMITER: { limit: async ({ key }) => (keys.push(key), { success: true }) } };
    const send = () => app.request("/limited", { method: "POST", headers: { "CF-Connecting-IP": CLIENT_IP } }, env);
    return { send, answered, records, keys, reached };
  }

  for (const mounting of [groupLevel, ...routeLevel]) {
    it(`keys ${mounting.name} by CF-Connecting-IP when the chain trusts the CF headers`, async () => {
      const { send, answered, keys, reached } = limitedApp(mounting, true);

      const res = await send();

      expect({ status: res.status, body: await res.text(), keys, answered, reached }).toEqual({
        status: 200,
        body: "ok",
        keys: [CLIENT_IP],
        answered: [],
        reached: ["handler"],
      });
    });
  }

  for (const mounting of routeLevel) {
    it(`answers ${mounting.name} 503 key-failed through the chain's hook, logged, when the chain does not trust the CF headers`, async () => {
      const { send, answered, records, keys, reached } = limitedApp(mounting, false);

      const res = await send();

      expect({
        status: res.status,
        body: await res.text(),
        keys,
        answered,
        reached,
        logged: records
          .filter((record) => record.data?.["guard"] === "rate-limit")
          .map(({ level, message, data }) => ({ level, message, status: data?.["status"], reason: data?.["reason"] })),
      }).toEqual({
        status: 503,
        body: "chain refused",
        keys: [],
        answered: [{ guard: "rate-limit", status: 503, reason: "key-failed" }],
        reached: [],
        logged: [{ level: "error", message: "security.rate-limit.refused", status: 503, reason: "key-failed" }],
      });
    });
  }

  /** The chain with a keyless `rateLimit` in `before`, answering its own refusals. */
  function limitedInBefore(trusted: boolean) {
    const answered: Refusal[] = [];
    const keys: string[] = [];
    const app = new Forge<LimitedEnv>();
    const limit = rateLimit<LimitedEnv>({
      binding: "LIMITER",
      onRefuse: (_c, refusal) => (answered.push(refusal), new Response("limit refused", { status: refusal.status })),
    });
    applyMiddlewareChain<LimitedEnv>(app, {
      ...DECLARES_LIMITER,
      ...(trusted ? { trustCfHeaders: true } : {}),
      securityHeaders: {},
      before: [limit],
    });
    mapHandler(app, "POST", "/limited", () => new Response("ok"));
    const env: LimitedEnv = { LIMITER: { limit: async ({ key }) => (keys.push(key), { success: true }) } };
    const send = () => app.request("/limited", { method: "POST", headers: { "CF-Connecting-IP": CLIENT_IP } }, env);
    return { send, answered, keys };
  }

  it("keys a rateLimit in `before` by CF-Connecting-IP when the chain trusts the CF headers", async () => {
    const { send, answered, keys } = limitedInBefore(true);

    const res = await send();

    expect({ status: res.status, body: await res.text(), keys, answered }).toEqual({ status: 200, body: "ok", keys: [CLIENT_IP], answered: [] });
  });

  it("answers a keyless rateLimit in `before` 503 key-failed when the chain does not trust the CF headers", async () => {
    const { send, answered, keys } = limitedInBefore(false);

    const res = await send();

    expect({ status: res.status, body: await res.text(), keys, answered }).toEqual({
      status: 503,
      body: "limit refused",
      keys: [],
      answered: [{ guard: "rate-limit", status: 503, reason: "key-failed" }],
    });
  });
});

describe("applyMiddlewareChain — a 429's Retry-After from the chain's rateLimits", () => {
  const WINDOWS = { LIMITER: { limit: 5, period: 42 } };
  const DECLARES = { bindings: v.object({ LIMITER: v.optional(v.unknown()) }), rateLimits: WINDOWS };
  const spent: LimitedEnv = { LIMITER: { limit: async () => ({ success: false }) } };
  const keyed: RateLimitOptions<LimitedEnv> = { binding: "LIMITER", key: () => "client-1" };

  type Mounting = { name: string; before?: Middleware[]; guards?: MiddlewareGuardGroup<LimitedEnv>[]; route?: Middleware[] };
  const mountings: Mounting[] = [
    { name: "a guard group's rateLimit", guards: [{ paths: ["/limited"], rateLimit: keyed }] },
    { name: "a rateLimit in the route's own middleware", route: [rateLimit<LimitedEnv>(keyed)] },
    { name: "a rateLimit in `before`", before: [rateLimit<LimitedEnv>(keyed)] },
  ];

  const settingNone =
    (seen: Refusal[]): RefuseHook<LimitedEnv> =>
    (_c, refusal) => (seen.push(refusal), new Response("chain refused", { status: refusal.status }));

  type Answering = {
    name: string;
    hook?: (seen: Refusal[]) => RefuseHook<LimitedEnv>;
    expected: { body: string; retryAfter: string; seen: Refusal[] };
  };
  const answerings: Answering[] = [
    { name: "forge's default answer", expected: { body: "Too many requests. Please try again later.", retryAfter: "42", seen: [] } },
    {
      name: "a chain hook that sets no Retry-After",
      hook: settingNone,
      expected: { body: "chain refused", retryAfter: "42", seen: [{ guard: "rate-limit", status: 429, retryAfter: 42 }] },
    },
    {
      name: "a chain hook that sets its own Retry-After",
      hook: (seen) => (_c, refusal) => (
        seen.push(refusal),
        new Response("chain refused", { status: refusal.status, headers: { "Retry-After": "3" } })
      ),
      expected: { body: "chain refused", retryAfter: "3", seen: [{ guard: "rate-limit", status: 429, retryAfter: 42 }] },
    },
  ];

  async function refused(
    mounting: Mounting,
    options: Partial<MiddlewareChainOptions<LimitedEnv>>,
    hook?: (seen: Refusal[]) => RefuseHook<LimitedEnv>,
  ) {
    const seen: Refusal[] = [];
    const reached: string[] = [];
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain<LimitedEnv>(app, {
      ...options,
      securityHeaders: {},
      logging: { channels: () => [] },
      ...(mounting.before ? { before: mounting.before } : {}),
      ...(mounting.guards ? { guards: mounting.guards } : {}),
      ...(hook ? { onRefuse: hook(seen) } : {}),
    });
    mapHandler(
      app,
      "POST",
      "/limited",
      mounting.route ? { middleware: mounting.route, handler: recordingHandler("ok", reached) } : recordingHandler("ok", reached),
    );
    const res = await app.request("/limited", { method: "POST" }, spent);
    return {
      status: res.status,
      body: await res.text(),
      retryAfter: res.headers.get("Retry-After"),
      rateLimit: res.headers.get("RateLimit"),
      policy: res.headers.get("RateLimit-Policy"),
      seen,
      reached,
    };
  }

  for (const mounting of mountings) {
    for (const { name, hook, expected } of answerings) {
      it(`answers ${mounting.name} 429 through ${name} with Retry-After ${expected.retryAfter} and no RateLimit headers`, async () => {
        expect(await refused(mounting, DECLARES, hook)).toStrictEqual({ status: 429, rateLimit: null, policy: null, reached: [], ...expected });
      });
    }
  }

  for (const mounting of mountings.filter(({ guards }) => guards === undefined)) {
    it(`answers ${mounting.name} 429 with no Retry-After and no retryAfter when the chain publishes no rateLimits`, async () => {
      expect(await refused(mounting, {}, settingNone)).toStrictEqual({
        status: 429,
        body: "chain refused",
        retryAfter: null,
        rateLimit: null,
        policy: null,
        seen: [{ guard: "rate-limit", status: 429 }],
        reached: [],
      });
    });
  }
});

describe("the app barrel", () => {
  it("does not carry buildGuardChain", () => {
    expect(Object.values<unknown>(appBarrel).includes(buildGuardChain)).toBe(false);
  });
});

describe("a cors preflight under an origin group, with cors at app.use", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  it("answers an allowed-origin preflight 204 with the CORS headers, never reaching the handler", async () => {
    let handled = false;
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      csrf: { ring: () => ring, subject: false },
      guards: [{ paths: ["/api/*"], origin: { allowedOrigins: ["http://localhost"] } }],
    });
    app.use("/api/*", cors({ origins: ["https://partner.example.com"], methods: ["POST"] }));
    mapHandler(app, "ANY", "/api/save", () => {
      handled = true;
      return new Response("saved");
    });

    const res = await app.request("/api/save", {
      method: "OPTIONS",
      headers: { Origin: "https://partner.example.com", "Access-Control-Request-Method": "POST" },
    });

    expect({
      status: res.status,
      allowOrigin: res.headers.get("Access-Control-Allow-Origin"),
      allowMethods: res.headers.get("Access-Control-Allow-Methods"),
      handled,
    }).toEqual({ status: 204, allowOrigin: "https://partner.example.com", allowMethods: "POST", handled: false });
  });
});

describe("a cors preflight behind each kind of covering group, with cors at app.use", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([CSRF_SECRET]);
  });

  const PARTNER = "https://partner.example.com";
  const PREFLIGHT = { Origin: PARTNER, "Access-Control-Request-Method": "POST", "CF-Connecting-IP": "203.0.113.7" };
  const CORS = { origins: [PARTNER], methods: ["POST"], allowedHeaders: ["X-Partner-Key"], maxAge: 600 };

  function corsApp(world: ReturnType<typeof csrfWorld>, group: MiddlewareGuardGroup<LimitedEnv>, exclude?: readonly string[]): Forge<LimitedEnv> {
    const app = new Forge<LimitedEnv>();
    applyMiddlewareChain(app, {
      ...DECLARES_LIMITER,
      securityHeaders: {},
      trustCfHeaders: true,
      onRefuse: world.onRefuse("policy"),
      csrf: { ring: world.ring, subject: false, ...(exclude ? { exclude } : {}) },
      guards: [group],
    });
    app.use("/api/*", cors(CORS));
    mapHandler(app, "ANY", "/api/save", recordingHandler("saved", world.events));
    mapHandler(app, "ANY", "/api/hooks/in", recordingHandler("hooked", world.events));
    mapHandler(app, "POST", "/other", recordingHandler("other", world.events));
    return app;
  }

  async function corsView(res: Response) {
    return {
      status: res.status,
      body: await res.text(),
      allowOrigin: res.headers.get("Access-Control-Allow-Origin"),
      allowMethods: res.headers.get("Access-Control-Allow-Methods"),
      allowHeaders: res.headers.get("Access-Control-Allow-Headers"),
      maxAge: res.headers.get("Access-Control-Max-Age"),
    };
  }

  const ANSWERED = { status: 204, body: "", allowOrigin: PARTNER, allowMethods: "POST", allowHeaders: "X-Partner-Key", maxAge: "600" };

  it("answers an allowed-origin preflight 204 behind origin, rateLimit and guards groups alike, never resolving the ring", async () => {
    const cases: { name: string; group: (events: string[]) => MiddlewareGuardGroup<LimitedEnv>; events: string[] }[] = [
      { name: "origin", group: () => ({ paths: ["/api/*"], origin: { allowedOrigins: ["http://localhost"] } }), events: [] },
      { name: "rateLimit", group: () => ({ paths: ["/api/*"], rateLimit: { binding: "LIMITER" } }), events: ["limit"] },
      { name: "guards", group: (events) => ({ paths: ["/api/*"], guards: [probe("guard", events)] }), events: ["guard"] },
    ];

    for (const { name, group, events } of cases) {
      const world = csrfWorld(ring);
      const res = await corsApp(world, group(world.events)).request("/api/save", { method: "OPTIONS", headers: PREFLIGHT }, world.env());
      expect({ name, ...(await corsView(res)), events: world.events }).toEqual({ name, ...ANSWERED, events });
    }
  });

  it("answers a disallowed-origin preflight without any Access-Control-Allow header, never reaching the handler", async () => {
    const world = csrfWorld(ring);
    const app = corsApp(world, { paths: ["/api/*"], origin: { allowedOrigins: ["http://localhost"] } });

    const res = await app.request("/api/save", { method: "OPTIONS", headers: { ...PREFLIGHT, Origin: "https://evil.example.net" } }, world.env());

    expect({ ...(await corsView(res)), vary: res.headers.get("Vary"), events: world.events }).toEqual({
      status: 204,
      body: "",
      allowOrigin: null,
      allowMethods: null,
      allowHeaders: null,
      maxAge: null,
      vary: "Origin",
      events: [],
    });
  });

  it("refuses an OPTIONS carrying Origin alone under the group with a csrf 403", async () => {
    const world = csrfWorld(ring);
    const app = corsApp(world, { paths: ["/api/*"], origin: { allowedOrigins: ["http://localhost"] } });

    const res = await app.request("/api/save", { method: "OPTIONS", headers: { Origin: PARTNER } }, world.env());

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 403,
      body: "policy refused: missing-token",
      events: ["ring", "policy:missing-token"],
    });
  });

  it("refuses a tokenless OPTIONS with a form body and no Access-Control-Request-Method under the group", async () => {
    const world = csrfWorld(ring);
    const app = corsApp(world, { paths: ["/api/*"], origin: { allowedOrigins: ["http://localhost"] } });

    const res = await app.request("/api/save", { ...world.post({ Origin: PARTNER }), method: "OPTIONS" }, world.env());

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 403,
      body: "policy refused: missing-token",
      events: ["body", "ring", "policy:missing-token"],
    });
  });

  it("lets a preflight to a path no cors covers reach the router's method-mismatch answer, unarmed", async () => {
    const world = csrfWorld(ring);
    const app = corsApp(world, { paths: ["*"], origin: { allowedOrigins: ["http://localhost"] } });

    const preflight = await app.request("/other", { method: "OPTIONS", headers: PREFLIGHT }, world.env());
    const bare = await app.request("/other", { method: "OPTIONS", headers: { Origin: PARTNER } }, world.env());

    expect([
      { status: preflight.status, body: await preflight.text(), allowOrigin: preflight.headers.get("Access-Control-Allow-Origin") },
      { status: bare.status, body: await bare.text(), allowOrigin: bare.headers.get("Access-Control-Allow-Origin") },
      world.events,
    ]).toEqual([
      { status: 404, body: "Not Found", allowOrigin: null },
      { status: 403, body: "policy refused: missing-token", allowOrigin: null },
      ["ring", "policy:missing-token"],
    ]);
  });

  it("answers a preflight 204 on both sides of the csrf exclude, while an Origin-only OPTIONS is refused only outside it", async () => {
    const world = csrfWorld(ring);
    const app = corsApp(world, { paths: ["/api/*"], origin: { allowedOrigins: ["http://localhost"] } }, ["/api/hooks/*"]);
    const send = async (path: string, headers: Record<string, string>) => {
      const res = await app.request(path, { method: "OPTIONS", headers }, world.env());
      return { status: res.status, body: await res.text(), allowOrigin: res.headers.get("Access-Control-Allow-Origin") };
    };

    expect([
      await send("/api/hooks/in", PREFLIGHT),
      await send("/api/save", PREFLIGHT),
      await send("/api/hooks/in", { Origin: PARTNER }),
      await send("/api/save", { Origin: PARTNER }),
      world.events,
    ]).toEqual([
      { status: 204, body: "", allowOrigin: PARTNER },
      { status: 204, body: "", allowOrigin: PARTNER },
      { status: 200, body: "hooked", allowOrigin: PARTNER },
      { status: 403, body: "policy refused: missing-token", allowOrigin: null },
      ["handler", "ring", "policy:missing-token"],
    ]);
  });
});
