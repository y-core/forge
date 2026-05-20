import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { checkCrossOriginProtection, crossOriginProtection } from "./cop";

function makeApp() {
  const app = new Hono();
  app.use("*", crossOriginProtection());
  app.get("/test", (c) => c.text("ok"));
  app.post("/test", (c) => c.text("ok"));
  app.put("/test", (c) => c.text("ok"));
  app.delete("/test", (c) => c.text("ok"));
  return app;
}

describe("checkCrossOriginProtection", () => {
  it("allows GET regardless of Sec-Fetch-Site", () => {
    const req = new Request("https://example.com/test", {
      method: "GET",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows HEAD regardless of Sec-Fetch-Site", () => {
    const req = new Request("https://example.com/test", {
      method: "HEAD",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows OPTIONS regardless of Sec-Fetch-Site", () => {
    const req = new Request("https://example.com/test", {
      method: "OPTIONS",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows POST with Sec-Fetch-Site: same-origin", () => {
    const req = new Request("https://example.com/test", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows POST with Sec-Fetch-Site: same-site", () => {
    const req = new Request("https://example.com/test", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-site" },
    });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("allows POST with Sec-Fetch-Site: none (direct navigation)", () => {
    const req = new Request("https://example.com/test", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "none" },
    });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });

  it("blocks POST with Sec-Fetch-Site: cross-site", () => {
    const req = new Request("https://example.com/test", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: false, reason: "cross-site" });
  });

  it("allows POST when Sec-Fetch-Site is absent (non-browser client)", () => {
    const req = new Request("https://example.com/test", { method: "POST" });
    expect(checkCrossOriginProtection(req)).toEqual({ ok: true });
  });
});

describe("crossOriginProtection middleware", () => {
  const app = makeApp();

  it("allows GET from cross-site (safe method)", async () => {
    const res = await app.request("/test", {
      method: "GET",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(200);
  });

  it("allows POST from same-origin", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 for POST from cross-site", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("allows DELETE with no Sec-Fetch-Site (server-to-server)", async () => {
    const res = await app.request("/test", { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});
