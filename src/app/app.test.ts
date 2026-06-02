import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Config } from "../config/config";
import { route } from "../router/config";
import { applyRoutes } from "../router/register";
import { v } from "../validation/mod";
import { createApp } from "./app";

describe("createApp", () => {
  it("error boundary returns 500 HTML for unhandled errors", async () => {
    const app = createApp();
    app.get("/boom", () => {
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
    app.get("/boom", () => {
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
      app.get("/boom", () => {
        throw new Error("secret db error");
      });
      await app.request("/boom");
      expect(logs.length).toBeGreaterThan(0);
      const parsed = JSON.parse(logs[0]) as Record<string, unknown>;
      expect(parsed.prefix).toBe("app");
      expect(parsed.error).toBe("secret db error");
    });
  });

  it("calls custom onError when provided", async () => {
    const app = createApp({
      onError: (_err, c) => c.text("custom error", 503),
    });
    app.get("/boom", () => {
      throw new Error("oops");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("custom error");
  });

  it("shows error details when isDebug returns true", async () => {
    const app = createApp({ isDebug: () => true });
    app.get("/boom", () => {
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
    app.get("/boom", () => {
      throw new Error("<script>alert(1)</script>");
    });

    const res = await app.request("/boom");
    const text = await res.text();
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<script>");
  });

  it("hides error details when isDebug returns false", async () => {
    const app = createApp({ isDebug: () => false });
    app.get("/boom", () => {
      throw new Error("secret info");
    });

    const res = await app.request("/boom");
    const text = await res.text();
    expect(text).toContain("An unexpected error occurred.");
    expect(text).not.toContain("secret info");
  });

  it("injects config into route handlers when a Config instance is provided", async () => {
    type AppEnv = { Bindings: { DB_URL: string }; Config: { dbUrl: string } };

    const app = createApp<AppEnv>({
      config: new Config({ dbUrl: { __env: "DB_URL" } }, v.object({ dbUrl: v.string() })),
    });

    applyRoutes(app, [
      route("/config-test", {
        loader: (_c, config) => ({ url: config?.dbUrl }),
        view: (c, _config, state) => c.text((state.data as { url: string }).url),
      }),
    ]);

    const res = await app.request("/config-test", {}, { DB_URL: "postgres://localhost/test" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("postgres://localhost/test");
  });
});
