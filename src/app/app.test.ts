import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createController } from "@remix-run/fetch-router";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";

import { createConfig } from "../config/config";
import { devAllowance } from "../dev/allowance";
import { csrfProtection, importCsrfKey } from "../form/csrf";
import type { SerializedError } from "../logging/types";
import { MatcherResourceError } from "../router/mod";
import { createSecurityHeaders } from "../security/headers";
import { rateLimit } from "../security/rate-limit";
import { requestId } from "../security/request-id";
import { mapHandler } from "../testing/route";
import { v } from "../validation/validation";
import { createApp } from "./app";
import { Forge } from "./forge-app";
import { definePage } from "./page";

const UNEXPECTED = "An unexpected error occurred.";

/** The baseline 500 document `Forge` renders for an error that never reached the middleware chain. */
const boundary = (detail: string, reference?: string): string =>
  `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>${detail}</p>${reference ? `<p>Reference: ${reference}</p>` : ""}</body></html>`;

describe("createApp", () => {
  it("error boundary returns 500 HTML for unhandled errors", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("test explosion");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(boundary(UNEXPECTED));
  });

  it("does not leak error details to the response", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("secret db connection string leaked");
    });

    const res = await app.request("/boom");
    const text = await res.text();
    expect(text).toBe(boundary(UNEXPECTED));
  });

  describe("error logging", () => {
    let logs: string[] = [];
    let originalLog: typeof console.log;

    beforeEach(() => {
      logs = [];
      originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it("logs unhandled errors server-side", async () => {
      const app = createApp();
      mapHandler(app, "GET", "/boom", () => {
        throw new Error("secret db error");
      });
      await app.request("/boom");
      expect(logs.length).toBeGreaterThan(0);
      const parsed = JSON.parse(logs[0]!) as Record<string, unknown>;
      expect(parsed.prefix).toBe("app");
      const error = parsed.error as SerializedError;
      expect(error.message).toBe("secret db error");
      expect(error.name).toBe("Error");
      expect(typeof error.stack).toBe("string");
    });

    it("records an unhandled page error exactly once", async () => {
      const app = createApp();
      mapHandler(
        app,
        "GET",
        "/boom",
        definePage({
          view: () => {
            throw new Error("view exploded");
          },
        }),
      );

      await app.request("/boom");
      const records = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records.length).toBe(1);
      expect(records[0]!.prefix).toBe("app");
      expect(records[0]!.message).toBe("Unhandled error");
    });

    it("records a throwing onError override against the hook, keeping the original's report", async () => {
      const app = createApp({
        onError: () => {
          throw new Error("override boom");
        },
      });
      mapHandler(app, "GET", "/boom", () => {
        throw new Error("original");
      });

      await app.request("/boom");
      const records = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
      const attribution = records.find((r) => r.message === "onError override threw")!;
      expect(attribution.level).toBe("error");
      expect((attribution.error as SerializedError).message).toBe("override boom");
      expect((attribution.original as SerializedError).message).toBe("original");
      expect(records.some((r) => r.message === "Unhandled error")).toBe(true);
    });
  });

  it("calls custom onError when provided", async () => {
    const app = createApp({ onError: (_err) => new Response("custom error", { status: 503 }) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("oops");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("custom error");
  });

  it("shows error details under a dev allowance granting errorDetail", async () => {
    const app = createApp({ dev: devAllowance({ errorDetail: true }) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("database timeout");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(boundary("database timeout"));
  });

  it("escapes HTML in debug error messages", async () => {
    const app = createApp({ dev: devAllowance({ errorDetail: true }) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("<script>alert(1)</script>");
    });

    const res = await app.request("/boom");
    const text = await res.text();
    expect(text).toBe(boundary("&lt;script&gt;alert(1)&lt;/script&gt;"));
  });

  it("hides error details when the allowance grants something else", async () => {
    const app = createApp({ dev: devAllowance({ rateLimitOptional: true }) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("secret info");
    });

    const res = await app.request("/boom");
    const text = await res.text();
    expect(text).toBe(boundary(UNEXPECTED));
  });

  it("exposes env bindings inside route handlers", async () => {
    type AppBindings = { API_KEY: string };
    const app = createApp<AppBindings>();
    mapHandler(app, "GET", "/env-check", (context) => {
      const env = (context as unknown as { env: AppBindings }).env;
      return new Response(env.API_KEY);
    });

    const res = await app.request("/env-check", {}, { API_KEY: "secret-key-123" } as AppBindings);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("secret-key-123");
  });

  it("exposes executionCtx.waitUntil inside route handlers", async () => {
    const app = createApp();
    let resolved = false;

    mapHandler(app, "GET", "/ctx-check", (context) => {
      const ctx = (context as unknown as { executionCtx: ExecutionContext }).executionCtx;
      ctx.waitUntil(
        Promise.resolve().then(() => {
          resolved = true;
        }),
      );
      return new Response("ok");
    });

    const res = await app.request("/ctx-check");
    expect(res.status).toBe(200);
    expect(resolved).toBe(true);
  });

  it("injects config into route handlers when a Config instance is provided", async () => {
    type AppBindings = { DB_URL: string };

    const app = createApp<AppBindings>({ config: createConfig({ dbUrl: { __env: "DB_URL" } }, v.object({ dbUrl: v.string() })) });

    mapHandler(app, "GET", "/config-test", (context) => {
      // oxlint-disable-next-line typescript/no-explicit-any -- config accessed via context property
      const config = (context as any).config as { dbUrl: string };
      return new Response(config.dbUrl);
    });

    const res = await app.request("/config-test", {}, { DB_URL: "postgres://localhost/test" } as AppBindings);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("postgres://localhost/test");
  });
});

describe("error path carries security headers (F9)", () => {
  it("attaches CSP, HSTS, and X-Content-Type-Options to a 500 response", async () => {
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("x");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-security-policy")).not.toBeNull();
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("attaches security headers to a CSRF 403 rejection", async () => {
    const key = await importCsrfKey("a".repeat(64));
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    app.use("*", csrfProtection({ secret: () => key, subject: false }));
    mapHandler(app, "POST", "/submit", () => new Response("should not reach"));

    const res = await app.request("/submit", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Alice", // no CSRF token
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("attaches security headers to a rate-limit 429 rejection", async () => {
    type Env = { LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> } };
    const app = new Forge<Env>();
    app.use("*", createSecurityHeaders());
    app.use("*", rateLimit<Env>({ limiter: (c) => c.env.LIMITER, trustCfHeaders: true }));
    mapHandler(app, "POST", "/submit", () => new Response("should not reach"));

    const res = await app.request(
      "/submit",
      { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.7" } },
      { LIMITER: { limit: async () => ({ success: false }) } },
    );
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("Too many requests. Please try again later.");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });
});

describe("invalid env is handled by the app, not thrown out of fetch", () => {
  const store = () => createConfig({ dbUrl: { __env: "DB_URL" } }, v.object({ dbUrl: v.string() }));

  it("yields the app's own 500 with baseline hardening headers instead of a raw throw", async () => {
    const app = createApp({ config: store() });
    mapHandler(app, "GET", "/", () => new Response("unreachable"));

    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(boundary(UNEXPECTED));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("routes the failure through the consumer onError hook", async () => {
    const app = createApp({ config: store(), onError: (err) => new Response(err.message, { status: 503 }) });
    mapHandler(app, "GET", "/", () => new Response("unreachable"));

    const res = await app.request("/", {}, {});
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Invalid environment: dbUrl: missing");
  });

  it("leaves a valid env completely unaffected", async () => {
    const app = createApp<{ DB_URL: string }>({ config: store() });
    mapHandler(app, "GET", "/", (context) => new Response((context as unknown as { config: { dbUrl: string } }).config.dbUrl));

    const res = await app.request("/", {}, { DB_URL: "postgres://localhost/test" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("postgres://localhost/test");
  });
});

describe("a throwing app.use guard stays inside the chain", () => {
  it("is caught by the boundary and the response still gets the pending-header flush", async () => {
    const app = new Forge();
    app.use("*", requestId());
    app.use("*", () => {
      throw new Error("guard exploded");
    });
    mapHandler(app, "GET", "/", () => new Response("unreachable"));

    const res = await app.request("/");
    expect(res.status).toBe(500);
    const id = res.headers.get("x-request-id")!;
    expect(id).not.toBeNull();
    expect(await res.text()).toBe(boundary(UNEXPECTED, id));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
  });

  it("still lets a non-throwing guard chain serve a normal response", async () => {
    const app = new Forge();
    app.use("*", requestId());
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("x-request-id")).not.toBeNull();
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
  });
});

describe("baseline hardening on the error path (no consumer middleware)", () => {
  it("a throwing handler yields 500 with baseline hardening headers", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("kaboom");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("onError override fallback", () => {
  it("uses the consumer onError override when it returns a response", async () => {
    const app = createApp({ onError: () => new Response("handled", { status: 418 }) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("original");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(418);
    expect(await res.text()).toBe("handled");
  });

  it("falls back to the default error page when the onError override itself throws", async () => {
    const app = createApp({
      onError: () => {
        throw new Error("override boom");
      },
    });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("original");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(boundary(UNEXPECTED));
  });
});

describe("HEAD requests", () => {
  it("returns an empty body with the same status and headers as the GET", async () => {
    const app = createApp();
    mapHandler(
      app,
      "GET",
      "/page",
      () => new Response("hello world", { status: 201, headers: { "x-custom": "kept", "content-type": "text/plain;charset=utf-8" } }),
    );

    const getRes = await app.request("/page");
    expect(getRes.status).toBe(201);
    expect(await getRes.text()).toBe("hello world");

    const headRes = await app.request("/page", { method: "HEAD" });
    expect(headRes.status).toBe(201);
    expect(await headRes.text()).toBe("");
    expect(headRes.headers.get("x-custom")).toBe("kept");
    expect(headRes.headers.get("content-type")).toBe(getRes.headers.get("content-type"));
  });

  it("returns a null body with 500 and baseline hardening headers for a throwing route", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("boom");
    });

    const headRes = await app.request("/boom", { method: "HEAD" });
    expect(headRes.status).toBe(500);
    expect(await headRes.text()).toBe("");
    expect(headRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(headRes.headers.get("content-security-policy")).toBe("default-src 'none'");
  });

  it("propagates the caller's abort signal into the derived GET", async () => {
    const app = createApp();
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    mapHandler(app, "GET", "/signal", (c) => {
      seen = c.request.signal;
      return new Response("ok");
    });

    const res = await app.request("/signal", { method: "HEAD", signal: controller.signal });
    expect(res.status).toBe(200);
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(seen?.aborted).toBe(true);
  });

  it("cancels the GET body it discards", async () => {
    const app = createApp();
    let cancelled = false;
    mapHandler(
      app,
      "GET",
      "/stream",
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );

    const res = await app.request("/stream", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(cancelled).toBe(true);
  });

  it("carries the GET's content-length", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/sized", () => new Response("hello world", { headers: { "content-length": "11" } }));

    const getRes = await app.request("/sized");
    const headRes = await app.request("/sized", { method: "HEAD" });
    expect(headRes.headers.get("content-length")).toBe("11");
    expect(headRes.headers.get("content-length")).toBe(getRes.headers.get("content-length"));
  });

  // The router now serves HEAD off a GET route itself, so two layers strip the same body. Forge's
  // rewrite reaches the router as a GET, which is what keeps the router's layer out of the way.
  it("reaches the handler as a GET, so the router's own HEAD handling never runs a second strip", async () => {
    const app = createApp();
    const methods: string[] = [];
    mapHandler(app, "GET", "/once", (c) => {
      methods.push(c.request.method);
      return new Response("hello world", { status: 201, headers: { "x-custom": "kept" } });
    });

    const res = await app.request("/once", { method: "HEAD" });
    expect(methods).toEqual(["GET"]);
    expect(res.status).toBe(201);
    expect(res.headers.get("x-custom")).toBe("kept");
    expect(await res.text()).toBe("");
  });

  it("strips the body of the hardened 405 the rewritten GET earns, and keeps its baseline headers", async () => {
    const app = createApp({ methodMismatch: "advertise" });
    mapHandler(app, "POST", "/submit", () => new Response("posted"));

    const res = await app.request("/submit", { method: "HEAD" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toBe("");
  });

  it("strips the body of the default not-found answer a mismatched HEAD earns", async () => {
    const app = createApp();
    mapHandler(app, "POST", "/submit", () => new Response("posted"));

    const res = await app.request("/submit", { method: "HEAD" });
    expect(res.status).toBe(404);
    expect(res.headers.get("allow")).toBeNull();
    expect(await res.text()).toBe("");
  });
});

describe("/admin/* middleware matching (F3)", () => {
  it("runs the guard for /admin and /admin/x but not /administrator", async () => {
    const hits: string[] = [];
    const app = new Forge();
    app.use("/admin/*", (c, next) => {
      hits.push(c.url.pathname);
      return next();
    });
    mapHandler(app, "GET", "/admin", () => new Response("a"));
    mapHandler(app, "GET", "/admin/x", () => new Response("b"));
    mapHandler(app, "GET", "/administrator", () => new Response("c"));

    await app.request("/admin");
    await app.request("/admin/x");
    await app.request("/administrator");

    expect(hits).toEqual(["/admin", "/admin/x"]);
  });

  it("registers one guard for an array of paths, matching any of them", async () => {
    const hits: string[] = [];
    const app = new Forge();
    app.use(["/admin/*", "/api/users"], (c, next) => {
      hits.push(c.url.pathname);
      return next();
    });
    mapHandler(app, "GET", "/admin/users", () => new Response("a"));
    mapHandler(app, "GET", "/api/users", () => new Response("b"));
    mapHandler(app, "GET", "/administrator", () => new Response("c"));

    await app.request("/admin/users");
    await app.request("/api/users");
    await app.request("/administrator");

    expect(hits).toEqual(["/admin/users", "/api/users"]);
  });
});

describe("security headers without a session (F10/F11)", () => {
  it("emits CSP and HSTS on the session-less path", async () => {
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).not.toBeNull();
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("builds headers once and leaves the response body intact", async () => {
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/ok", () => new Response("ok"));

    const res = await app.request("/ok");
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("content-security-policy")).not.toBeNull();
  });
});

describe("createApp — ordered wiring", () => {
  it("invokes middleware, routes, and finalize callbacks in order at construction", () => {
    const order: string[] = [];
    createApp({ middleware: () => order.push("middleware"), routes: () => order.push("routes"), finalize: () => order.push("finalize") });
    expect(order).toEqual(["middleware", "routes", "finalize"]);
  });

  it("registers the asset catch-all last so real routes win", async () => {
    const app = createApp({
      routes: (a) => mapHandler(a, "GET", "/page", () => new Response("real route")),
      assets: true,
      notFound: () => new Response("not found", { status: 404 }),
    });

    const route = await app.request("/page");
    expect(await route.text()).toBe("real route");

    const missing = await app.request("/nope");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("not found");
  });

  it("finalize routes are registered before the asset catch-all", async () => {
    const app = createApp({
      finalize: (a) => mapHandler(a, "GET", "/dev/logs", () => new Response("dev route")),
      assets: true,
      notFound: () => new Response("not found", { status: 404 }),
    });

    const res = await app.request("/dev/logs");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("dev route");
  });

  it("middleware registered via the wiring field wraps routed handlers", async () => {
    const order: string[] = [];
    const app = createApp({
      middleware: (a) =>
        a.use("*", async (_c, next) => {
          order.push("guard");
          return next();
        }),
      routes: (a) =>
        mapHandler(a, "GET", "/", () => {
          order.push("handler");
          return new Response("ok");
        }),
    });

    await app.request("/");
    expect(order).toEqual(["guard", "handler"]);
  });

  it("accepts no options at all", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/", () => new Response("plain"));
    const res = await app.request("/");
    expect(await res.text()).toBe("plain");
  });
});

describe("the request id on an error page", () => {
  it("renders nothing and sets no header when the requestId middleware never ran", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("kaboom");
    });

    const res = await app.request("/boom");
    expect(await res.text()).toBe(boundary(UNEXPECTED));
    expect(res.headers.get("x-request-id")).toBeNull();
  });

  it("quotes the id the middleware assigned, and echoes it in the header", async () => {
    const app = createApp({ middleware: (a) => a.use("*", requestId()) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("kaboom");
    });

    const res = await app.request("/boom");
    const id = res.headers.get("x-request-id")!;
    expect(id).not.toBeNull();
    expect(await res.text()).toBe(boundary(UNEXPECTED, id));
  });

  it("escapes an id a trusted CF-Ray header supplied", async () => {
    const app = createApp({ middleware: (a) => a.use("*", requestId({ trustCfHeaders: true })) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("kaboom");
    });

    const res = await app.request("/boom", { headers: { "CF-Ray": "<script>alert(1)</script>" } });
    expect(await res.text()).toBe(boundary(UNEXPECTED, "&lt;script&gt;alert(1)&lt;/script&gt;"));
  });

  it("carries no id on the out-of-chain path, where no middleware ran", async () => {
    const app = createApp({
      config: createConfig({ dbUrl: { __env: "DB_URL" } }, v.object({ dbUrl: v.string() })),
      middleware: (a) => a.use("*", requestId()),
    });
    mapHandler(app, "GET", "/", () => new Response("unreachable"));

    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeNull();
    expect(await res.text()).toBe(boundary(UNEXPECTED));
  });
});

describe("createApp — the unmatched URL", () => {
  it("answers a hardened plain-text 404 that never echoes the path", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/no/such/secret-path");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("gives the same answer with and without the asset catch-all configured", async () => {
    const notFound = () => new Response("<h1>Nothing here</h1>", { status: 404, headers: { "content-type": "text/html" } });
    const routed = createApp({ notFound, routes: (a) => mapHandler(a, "GET", "/page", () => new Response("real route")) });
    const withAssets = createApp<{ ASSETS?: { fetch: (req: Request) => Promise<Response> } }>({
      notFound,
      routes: (a) => mapHandler(a, "GET", "/page", () => new Response("real route")),
      assets: true,
    });

    const bare = await routed.request("/missing");
    const asset = await withAssets.request("/missing", {}, { ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) } });

    expect(bare.status).toBe(404);
    expect(asset.status).toBe(404);
    expect(await bare.text()).toBe("<h1>Nothing here</h1>");
    expect(await asset.text()).toBe("<h1>Nothing here</h1>");
  });

  it("hands the hook the resolved app config", async () => {
    type AppBindings = { DB_URL: string };
    const app = createApp<AppBindings>({
      config: createConfig({ dbUrl: { __env: "DB_URL" } }, v.object({ dbUrl: v.string() })),
      notFound: (_c, config) => new Response((config as { dbUrl: string }).dbUrl, { status: 404 }),
    });

    const res = await app.request("/missing", {}, { DB_URL: "postgres://localhost/test" } as AppBindings);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("postgres://localhost/test");
  });

  it("flows the no-match answer back out through the pending-header flush", async () => {
    const app = createApp({ middleware: (a) => a.use("*", requestId()) });

    const res = await app.request("/missing");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).not.toBeNull();
  });
});

describe("createApp — a method mismatch, under the default `notFound`", () => {
  it("renders the not-found hook rather than advertising the methods the URL does serve", async () => {
    const app = createApp({ notFound: () => new Response("hook ran", { status: 404 }) });
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/page", { method: "POST" });
    expect(res.status).toBe(404);
    expect(res.headers.get("allow")).toBeNull();
    expect(await res.text()).toBe("hook ran");
  });

  // The whole point of the default: a probe cannot tell a registered URL from an absent one, so the
  // 404/405 split never becomes an oracle for enumerating routes a guard does not cover.
  it("answers a registered URL and an absent one identically, byte for byte", async () => {
    const app = createApp();
    mapHandler(app, "POST", "/internal/webhook", () => new Response("done"));

    const registered = await app.request("/internal/webhook", { method: "GET" });
    const absent = await app.request("/internal/no-such-hook", { method: "GET" });
    expect(registered.status).toBe(absent.status);
    expect(registered.headers.get("allow")).toBe(absent.headers.get("allow"));
    expect(await registered.text()).toBe(await absent.text());
  });

  it("falls to forge's hardened 404 when no hook is registered", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/page", { method: "PROPFIND" });
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toBe("Not Found");
  });

  it("answers the same way whether or not assets are mounted, so the catch-all decides nothing", async () => {
    const withAssets = createApp<{ ASSETS?: { fetch: (req: Request) => Promise<Response> } }>({
      notFound: () => new Response("hook ran", { status: 404 }),
      routes: (a) => mapHandler(a, "GET", "/page", () => new Response("real route")),
      assets: true,
    });
    const without = createApp({
      notFound: () => new Response("hook ran", { status: 404 }),
      routes: (a) => mapHandler(a, "GET", "/page", () => new Response("real route")),
    });

    const assetRes = await withAssets.request("/page", { method: "POST" }, { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } });
    const bareRes = await without.request("/page", { method: "POST" });
    expect(assetRes.status).toBe(bareRes.status);
    expect(await assetRes.text()).toBe(await bareRes.text());
  });

  it("reaches the answer through the middleware chain, so a guard's headers still land on it", async () => {
    const app = createApp({ middleware: (a) => a.use("*", requestId()) });
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/page", { method: "POST" });
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).not.toBeNull();
  });

  it("returns a route handler's own 405 untouched, because that route did dispatch", async () => {
    const app = createApp();
    mapHandler(app, "POST", "/deny", () => new Response("nope", { status: 405, headers: { allow: "GET" } }));

    const res = await app.request("/deny", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect(await res.text()).toBe("nope");
  });

  it("returns an ANY route's own 405 untouched, so the method-agnostic arm answers for itself", async () => {
    const app = createApp();
    mapHandler(app, "ANY", "/deny", () => new Response("nope", { status: 405, headers: { allow: "GET" } }));

    const res = await app.request("/deny", { method: "POST" });
    expect(res.status).toBe(405);
    expect(await res.text()).toBe("nope");
  });

  it("returns a notFound hook's own 405 untouched, because no pattern matched the URL at all", async () => {
    const app = createApp({ notFound: () => new Response("hook 405", { status: 405 }) });
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/no/such/path");
    expect(res.status).toBe(405);
    expect(await res.text()).toBe("hook 405");
  });
});

describe("createApp — a method mismatch, under `advertise`", () => {
  it("answers 405 with the methods the URL does serve, rather than the not-found hook", async () => {
    const app = createApp({ methodMismatch: "advertise", notFound: () => new Response("hook ran", { status: 404 }) });
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/page", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("leaves the not-found hook owning a URL that matches no pattern at all", async () => {
    const app = createApp({ methodMismatch: "advertise", notFound: () => new Response("hook ran", { status: 404 }) });
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/no/such/path", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("hook ran");
  });

  it("lists every method registered at the URL, so Allow reports the route map and not one route", async () => {
    const app = createApp({ methodMismatch: "advertise" });
    mapHandler(app, "GET", "/page", () => new Response("get"));
    mapHandler(app, "PUT", "/page", () => new Response("put"));

    const res = await app.request("/page", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD, PUT");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("Method Not Allowed");
  });

  it("answers a body that never echoes the method the client chose", async () => {
    const app = createApp({ methodMismatch: "advertise" });
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/page", { method: "PROPFIND" });
    const body = await res.text();
    expect(body).toBe("Method Not Allowed");
    expect(body).not.toContain("PROPFIND");
  });

  it("carries the same baseline hardening the default 404 does", async () => {
    const app = createApp({ methodMismatch: "advertise" });
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/page", { method: "PROPFIND" });
    expect(res.status).toBe(405);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  // The disclosure this mode opts into stops at the guard line: a guard that answers without calling
  // `next()` means no dispatch ran, so there is no 405 to rebuild and no `Allow` to leak.
  it("never reaches a route a rejecting guard covers, so Allow stays behind the guard", async () => {
    const app = createApp({ methodMismatch: "advertise", middleware: (a) => a.use("/admin/*", () => new Response("denied", { status: 403 })) });
    mapHandler(app, "POST", "/admin/delete-user", () => new Response("done"));

    const res = await app.request("/admin/delete-user", { method: "GET" });
    expect(res.status).toBe(403);
    expect(res.headers.get("allow")).toBeNull();
  });

  it("returns a route handler's own 405 untouched, because that route did dispatch", async () => {
    const app = createApp({ methodMismatch: "advertise" });
    mapHandler(app, "POST", "/deny", () => new Response("nope", { status: 405, headers: { allow: "GET" } }));

    const res = await app.request("/deny", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect(await res.text()).toBe("nope");
  });

  // An `ANY` catch-all matches the mismatched method and wins dispatch, so the router never counts an
  // allowed method. The mode governs routed URLs; a catch-all absorbing every method is its limit.
  it("is overridden by the asset catch-all, which answers the mismatch itself", async () => {
    const app = createApp<{ ASSETS?: { fetch: (req: Request) => Promise<Response> } }>({
      methodMismatch: "advertise",
      notFound: () => new Response("hook ran", { status: 404 }),
      routes: (a) => mapHandler(a, "GET", "/page", () => new Response("real route")),
      assets: true,
    });

    const res = await app.request("/page", { method: "POST" }, { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } });
    expect(res.status).toBe(404);
    expect(res.headers.get("allow")).toBeNull();
    expect(await res.text()).toBe("hook ran");
  });

  it("reaches the 405 through the middleware chain, so a guard's headers still land on it", async () => {
    const app = createApp({ methodMismatch: "advertise", middleware: (a) => a.use("*", requestId()) });
    mapHandler(app, "GET", "/page", () => new Response("real route"));

    const res = await app.request("/page", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("x-request-id")).not.toBeNull();
    expect(await res.text()).toBe("Method Not Allowed");
  });
});

describe("createApp — matcher resource limits", () => {
  it("answers 500 through the error boundary when a URL exceeds the match-work budget", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/users/:id/edit", () => new Response("real route"));

    const res = await app.request(`/users/${"a".repeat(128 * 1024)}/edit`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(boundary(UNEXPECTED));
  });

  it("still matches a URL twice the size Cloudflare will deliver, so the budget cannot bite a real request", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/users/:id/edit", () => new Response("real route"));

    const res = await app.request(`/users/${"a".repeat(32 * 1024)}/edit`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("real route");
  });

  it("refuses a single route pattern larger than the per-pattern ceiling", () => {
    const app = new Forge();
    expect(() => mapHandler(app, "GET", `/${"a".repeat(8192)}`, () => new Response("never"))).toThrow(MatcherResourceError);
  });

  it("refuses a `use()` path larger than the per-pattern ceiling, so a guard is held to the same ceiling", () => {
    const app = new Forge();
    expect(() => app.use(`/${"a".repeat(8192)}`, (_c, next) => next())).toThrow(MatcherResourceError);
  });
});

describe("Forge.map — declarative route registration", () => {
  it("registers a route via the underlying router and returns the router's value (void)", async () => {
    const app = new Forge();
    const routes = createRoutes({ home: new Route("GET", "/mapped") });
    const result = app.map(routes, createController(routes, { actions: { home: () => new Response("mapped ok") } }));

    expect(result).toBeUndefined();

    const res = await app.request("/mapped");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("mapped ok");
  });
});
