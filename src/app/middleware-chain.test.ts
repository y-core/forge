import { describe, expect, it } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import { getNonce } from "../security/headers";
import { requestIdCtx } from "../security/request-id";
import { mapHandler } from "../testing/route";
import { v } from "../validation/mod";
import { Forge } from "./forge-app";
import { applyMiddlewareChain, buildGuardChain } from "./middleware-chain";

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
      session: async (context, next) => {
        order.push("session");
        requestIdWasSet = requestIdCtx.getOptional(context) !== undefined;
        nonceWasSet = getNonce(context) !== "";
        return next();
      },
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
      session: probe("session", order),
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
      session: async (context, next) => {
        requestIdWasSet = requestIdCtx.getOptional(context) !== undefined;
        return next();
      },
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

  it("wires rate limiting onto guarded paths (over limit → 429) when trustCfHeaders is set", async () => {
    const app = new Forge<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      trustCfHeaders: true,
      guards: [{ paths: ["/api/save"], rateLimit: { limiter: (c) => c.env.LIMITER } }],
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

  it("registers a guard group once for overlapping paths", async () => {
    const order: string[] = [];
    let limitCalls = 0;
    const app = new Forge<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      trustCfHeaders: true,
      guards: [{ paths: ["/api/*", "/api/users"], rateLimit: { limiter: (c) => c.env.LIMITER }, guards: [probe("guard", order)] }],
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

  it("threads default-distrust to rate-limit guards (CF-Connecting-IP ignored → 503)", async () => {
    const app = new Forge<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>();
    applyMiddlewareChain(app, { securityHeaders: {}, guards: [{ paths: ["/api/save"], rateLimit: { limiter: (c) => c.env.LIMITER } }] });
    mapHandler(app, "POST", "/api/save", () => new Response("saved"));

    const res = await app.request(
      "/api/save",
      { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.7" } },
      { LIMITER: { limit: async () => ({ success: true }) } },
    );
    expect(res.status).toBe(503);
  });

  it("threads trustCfHeaders to requestId (adopts CF-Ray)", async () => {
    let capturedId: string | undefined;
    const app = new Forge();
    applyMiddlewareChain(app, {
      securityHeaders: {},
      trustCfHeaders: true,
      session: async (context, next) => {
        capturedId = requestIdCtx.getOptional(context);
        return next();
      },
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
      session: probe("session", order),
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
    applyMiddlewareChain(app, { securityHeaders: {}, session: probe("session", order) });
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
      session: async (context, next) => {
        capturedId = requestIdCtx.getOptional(context);
        return next();
      },
    });
    mapHandler(app, "GET", "/", () => new Response("ok"));

    await app.request("/", { headers: { "CF-Ray": "ray-abc-IAD" } });
    expect(capturedId).not.toBe("ray-abc-IAD");
    expect(capturedId).not.toBe(undefined);
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

  it("orders the chain origin → rateLimit → guards", async () => {
    const order: string[] = [];
    const chain = buildGuardChain<{ LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } }>(
      {
        paths: ["/guarded"],
        origin: { allowedOrigins: ["https://example.com"] },
        rateLimit: { limiter: (c) => c.env.LIMITER },
        guards: [probe("guard", order)],
      },
      { trustCfHeaders: true },
    );

    expect(chain).toHaveLength(3);
    const rejected = await runChain(chain as Middleware[], { headers: { origin: "https://evil.example.net" } });
    expect(rejected.status).toBe(403);
    expect(order).toEqual([]);
  });

  it("omits each absent part, leaving an empty chain for a policy-less group", () => {
    const order: string[] = [];
    expect(buildGuardChain({ paths: ["/x"] })).toEqual([]);
    expect(buildGuardChain({ paths: ["/x"], guards: [probe("guard", order)] })).toHaveLength(1);
    expect(buildGuardChain({ paths: ["/x"], origin: { allowedOrigins: ["https://example.com"] } })).toHaveLength(1);
  });

  it("threads trustCfHeaders into the rate limit it builds", async () => {
    const group = { paths: ["/guarded"], rateLimit: { limiter: (c: { env: { LIMITER: unknown } }) => c.env.LIMITER } };
    const env = { LIMITER: { limit: async () => ({ success: true }) } };
    const headers = { "CF-Connecting-IP": "203.0.113.7" };

    const trusting = await runChain(buildGuardChain(group as never, { trustCfHeaders: true }), { headers }, env);
    expect(trusting.status).toBe(200);

    const distrusting = await runChain(buildGuardChain(group as never), { headers }, env);
    expect(distrusting.status).toBe(503);
  });
});
