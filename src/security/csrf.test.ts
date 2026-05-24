import { beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createCsrfToken, csrfProtection, importCsrfKey, verifyCsrfToken } from "./csrf";

const HEX_SECRET = "b".repeat(64);

type CsrfVars = { Variables: { csrfToken?: string } };

describe("csrfProtection middleware", () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await importCsrfKey(HEX_SECRET);
  });

  function makeApp() {
    const app = new Hono<CsrfVars>();
    app.use("*", csrfProtection({ secret: key }));
    app.get("/test", (c) => c.text(c.get("csrfToken") ?? ""));
    app.post("/test", (c) => c.text("ok"));
    return app;
  }

  it("GET sets csrfToken on context", async () => {
    const app = makeApp();
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const token = await res.text();
    expect(token).not.toBe("");
    expect(token).toContain(".");
  });

  it("POST with valid X-CSRF-Token header passes", async () => {
    const app = makeApp();
    const getRes = await app.request("/test");
    const token = await getRes.text();

    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("POST with invalid X-CSRF-Token header returns 403", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-CSRF-Token": "invalid.token" },
    });
    expect(res.status).toBe(403);
  });

  it("POST with valid _csrf form field (fallback) passes", async () => {
    const app = makeApp();
    const getRes = await app.request("/test");
    const token = await getRes.text();

    const body = new URLSearchParams({ _csrf: token });
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
  });

  it("POST with no token returns 403", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Jane",
    });
    expect(res.status).toBe(403);
  });

  it("respects custom headerName option", async () => {
    const app = new Hono<CsrfVars>();
    app.use("*", csrfProtection({ secret: key, headerName: "X-My-Token" }));
    app.get("/test", (c) => c.text(c.get("csrfToken") ?? ""));
    app.post("/test", (c) => c.text("ok"));

    const getRes = await app.request("/test");
    const token = await getRes.text();

    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-My-Token": token },
    });
    expect(res.status).toBe(200);
  });
});

const HEX_SECRET_PURE = "a".repeat(64);

describe("CSRF token", () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await importCsrfKey(HEX_SECRET_PURE);
  });

  it("round-trip succeeds", async () => {
    const token = await createCsrfToken(key, "/api/contact");
    const result = await verifyCsrfToken(key, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("rejects when path does not match", async () => {
    const token = await createCsrfToken(key, "/api/contact");
    const result = await verifyCsrfToken(key, token, "/api/other");
    expect(result).toEqual({ ok: false, reason: "path-mismatch" });
  });

  it("rejects an expired token", async () => {
    const token = await createCsrfToken(key, "/api/contact");
    const result = await verifyCsrfToken(key, token, "/api/contact", -1);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered signature", async () => {
    const token = await createCsrfToken(key, "/api/contact");
    const [payload] = token.split(".");
    const result = await verifyCsrfToken(key, `${payload}.aGVsbG8gd29ybGQ`, "/api/contact");
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("rejects a malformed token with no dot separator", async () => {
    const result = await verifyCsrfToken(key, "notavalidtoken", "/api/contact");
    expect(result).toEqual({ ok: false, reason: "invalid-format" });
  });

  it("rejects a token with empty payload segment", async () => {
    const result = await verifyCsrfToken(key, ".aGVsbG8", "/api/contact");
    expect(result).toEqual({ ok: false, reason: "invalid-format" });
  });

  it("rejects an empty token", async () => {
    const result = await verifyCsrfToken(key, "", "/api/contact");
    expect(result).toEqual({ ok: false, reason: "missing-token" });
  });
});
