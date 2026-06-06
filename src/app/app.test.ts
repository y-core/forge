import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { RequestContext } from "@remix-run/fetch-router";
import { Config } from "../config/config";
import { makeSecurityHeaders } from "../security/headers";
import { v } from "../validation/mod";
import { createApp } from "./app";
import { Forge } from "./forge-app";
import { mapHandler } from "./route-test-helper";

describe("createApp", () => {
  it("error boundary returns 500 HTML for unhandled errors", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("test explosion");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("500");
    expect(text).toContain("An unexpected error occurred.");
    expect(text).not.toContain("test explosion");
  });

  it("does not leak error details to the response", async () => {
    const app = createApp();
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("secret db connection string leaked");
    });

    const res = await app.request("/boom");
    const text = await res.text();
    expect(text).not.toContain("secret db connection string leaked");
    expect(text).toContain("An unexpected error occurred.");
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
      expect(parsed.error).toBe("secret db error");
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

  it("shows error details when isDebug returns true", async () => {
    const app = createApp({ isDebug: () => true });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("database timeout");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("database timeout");
    expect(text).not.toContain("An unexpected error occurred.");
  });

  it("escapes HTML in debug error messages", async () => {
    const app = createApp({ isDebug: () => true });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("<script>alert(1)</script>");
    });

    const res = await app.request("/boom");
    const text = await res.text();
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<script>");
  });

  it("hides error details when isDebug returns false", async () => {
    const app = createApp({ isDebug: () => false });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("secret info");
    });

    const res = await app.request("/boom");
    const text = await res.text();
    expect(text).toContain("An unexpected error occurred.");
    expect(text).not.toContain("secret info");
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

    const app = createApp<AppBindings>({ config: new Config({ dbUrl: { __env: "DB_URL" } }, v.object({ dbUrl: v.string() })) });

    mapHandler(app, "GET", "/config-test", (context) => {
      // biome-ignore lint/suspicious/noExplicitAny: config accessed via context property
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
    app.use("*", makeSecurityHeaders());
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("x");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-security-policy")).not.toBeNull();
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
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
});

describe("security headers without a session (F10/F11)", () => {
  it("emits CSP and HSTS on the session-less path", async () => {
    const app = new Forge();
    app.use("*", makeSecurityHeaders());
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).not.toBeNull();
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("builds headers once and leaves the response body intact", async () => {
    const app = new Forge();
    app.use("*", makeSecurityHeaders());
    mapHandler(app, "GET", "/ok", () => new Response("ok"));

    const res = await app.request("/ok");
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("content-security-policy")).not.toBeNull();
  });
});
