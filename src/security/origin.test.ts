import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { originGuard, verifyOrigin } from "./origin";

function makeApp(allowed: string[]) {
  const app = new Hono();
  app.use("*", originGuard(allowed));
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

  it("returns 403 when both Origin and Referer are missing", async () => {
    const app = makeApp(ALLOWED);
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(403);
  });
});

const ALLOWED = ["https://example.com", "https://www.example.com"];

describe("verifyOrigin", () => {
  it("allows a matching Origin header", () => {
    const req = new Request("https://example.com/api/contact", {
      headers: { Origin: "https://example.com" },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: true });
  });

  it("rejects a disallowed Origin", () => {
    const req = new Request("https://example.com/api/contact", {
      headers: { Origin: "https://evil.com" },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "disallowed" });
  });

  it("falls back to Referer when Origin is absent and Referer matches", () => {
    const req = new Request("https://example.com/api/contact", {
      headers: { Referer: "https://example.com/page" },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: true });
  });

  it("rejects when Referer origin does not match", () => {
    const req = new Request("https://example.com/api/contact", {
      headers: { Referer: "https://evil.com/page" },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "disallowed" });
  });

  it("rejects when both Origin and Referer are absent", () => {
    const req = new Request("https://example.com/api/contact");
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "missing" });
  });

  it("Origin takes precedence over Referer", () => {
    const req = new Request("https://example.com/api/contact", {
      headers: {
        Origin: "https://evil.com",
        Referer: "https://example.com/page",
      },
    });
    expect(verifyOrigin(req, ALLOWED)).toEqual({ ok: false, reason: "disallowed" });
  });
});
