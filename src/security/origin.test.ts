import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { originGuard, verifyOrigin } from "./origin";

function makeApp(allowed: string[]) {
  const app = new Hono();
  app.use("*", originGuard(allowed));
  app.get("/test", (c) => c.text("ok"));
  app.post("/test", (c) => c.text("ok"));
  return app;
}

describe("originGuard middleware", () => {
  const ALLOWED = ["https://example.com"];

  it("allows a request with a matching Origin", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", {
      method: "POST",
      headers: { Origin: "https://example.com" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 for a mismatched Origin", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", {
      method: "POST",
      headers: { Origin: "https://evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when both Origin and Referer are missing on POST", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("GET without Origin or Referer passes (safe method)", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("HEAD without Origin or Referer passes (safe method)", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "HEAD" });
    expect(res.status).toBe(200);
  });
});

const ALLOWED = ["https://example.com", "https://www.example.com"];

describe("verifyOrigin", () => {
  it("allows a matching Origin header", () => {
    const req = new Request("https://example.com/api/contact", {
      method: "POST",
      headers: { Origin: "https://example.com" },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: true });
  });

  it("rejects a disallowed Origin", () => {
    const req = new Request("https://example.com/api/contact", {
      method: "POST",
      headers: { Origin: "https://evil.com" },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "disallowed" });
  });

  it("falls back to Referer when Origin is absent and Referer matches", () => {
    const req = new Request("https://example.com/api/contact", {
      method: "POST",
      headers: { Referer: "https://example.com/page" },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: true });
  });

  it("rejects when Referer origin does not match", () => {
    const req = new Request("https://example.com/api/contact", {
      method: "POST",
      headers: { Referer: "https://evil.com/page" },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "disallowed" });
  });

  it("rejects when both Origin and Referer are absent", () => {
    const req = new Request("https://example.com/api/contact", { method: "POST" });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "missing" });
  });

  it("Origin takes precedence over Referer", () => {
    const req = new Request("https://example.com/api/contact", {
      method: "POST",
      headers: {
        Origin: "https://evil.com",
        Referer: "https://example.com/page",
      },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "disallowed" });
  });

  it("returns missing for GET requests without Origin (no safe-method bypass)", () => {
    const req = new Request("https://example.com/api/contact", { method: "GET" });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "missing" });
  });

  it("returns missing for HEAD requests without Origin (no safe-method bypass)", () => {
    const req = new Request("https://example.com/api/contact", { method: "HEAD" });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "missing" });
  });
});
