import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createApp } from "./create-app";

describe("createApp", () => {
  it("applies security headers to every response by default", async () => {
    const app = createApp();
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test");
    expect(res.headers.get("content-security-policy")).not.toBeNull();
    expect(res.headers.get("strict-transport-security")).not.toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

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
});
