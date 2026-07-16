import { describe, expect, it } from "bun:test";
import type { Middleware } from "@remix-run/fetch-router";
import { getNonce } from "../security/headers";
import { requestIdCtx } from "../security/request-id";
import { v } from "../validation/mod";
import { Forge } from "./forge-app";
import { applyMiddlewareChain } from "./middleware-chain";
import { mapHandler } from "./route-test-helper";

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
      guards: [{ paths: ["/guarded"], middleware: [probe("guard", order)] }],
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
      guards: [{ paths: ["/guarded"], middleware: [probe("guard", order)] }],
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
