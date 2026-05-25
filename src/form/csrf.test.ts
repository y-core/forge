import { beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createCsrfToken, csrfProtection, importCsrfKey, verifyCsrfToken } from "./csrf";
import { parseFormData } from "./parse-form-data";
import type { CsrfVariables } from "./types";

describe("importCsrfKey()", () => {
  it("rejects an odd-length hex string", async () => {
    await expect(importCsrfKey("a".repeat(63))).rejects.toThrow(
      "CSRF secret must have an even number of hex characters",
    );
  });

  it("rejects non-hex characters", async () => {
    await expect(importCsrfKey("zz".repeat(16))).rejects.toThrow(
      "CSRF secret must contain only hexadecimal characters (0-9, a-f, A-F)",
    );
  });

  it("accepts valid lowercase hex", async () => {
    await expect(importCsrfKey("a".repeat(64))).resolves.toBeDefined();
  });

  it("accepts valid uppercase hex", async () => {
    await expect(importCsrfKey("A".repeat(64))).resolves.toBeDefined();
  });

  it("accepts valid mixed-case hex", async () => {
    await expect(importCsrfKey("aAbB0123".repeat(8))).resolves.toBeDefined();
  });
});

const HEX_SECRET = "b".repeat(64);

describe("csrfProtection middleware", () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await importCsrfKey(HEX_SECRET);
  });

  function makeApp() {
    const app = new Hono<CsrfVariables>();
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
    const app = new Hono<CsrfVariables>();
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

  it("GET sets mintCsrfToken on context", async () => {
    let capturedMint: ((path: string) => Promise<string>) | undefined;
    const app = new Hono<CsrfVariables>();
    app.use("*", csrfProtection({ secret: key }));
    app.get("/test", (c) => {
      capturedMint = c.get("mintCsrfToken");
      return c.text("ok");
    });
    await app.request("/test");
    expect(typeof capturedMint).toBe("function");
  });

  it("token minted with mintCsrfToken for a specific path validates on that path", async () => {
    let capturedMint: ((path: string) => Promise<string>) | undefined;
    const app = new Hono<CsrfVariables>();
    app.use("*", csrfProtection({ secret: key }));
    app.get("/contact", (c) => {
      capturedMint = c.get("mintCsrfToken");
      return c.text("ok");
    });
    app.post("/api/contact", (c) => c.text("submitted"));

    await app.request("/contact");
    const apiToken = await capturedMint!("/api/contact");
    const res = await app.request("/api/contact", {
      method: "POST",
      headers: { "X-CSRF-Token": apiToken },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("submitted");
  });

  it("POST with _csrf form field — action handler reuses cached parseFormData", async () => {
    let captured: string | null = null;
    const app = new Hono<CsrfVariables>();
    app.use("*", csrfProtection({ secret: key }));
    app.get("/test", (c) => c.text(c.get("csrfToken") ?? ""));
    app.post("/test", async (c) => {
      const fd = await parseFormData(c);
      captured = fd.get("name") as string;
      return c.text("ok");
    });

    const getRes = await app.request("/test");
    const token = await getRes.text();

    const body = new URLSearchParams({ _csrf: token, name: "Alice" });
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    expect(captured).toBe("Alice");
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

  it("accepts a token with a timestamp slightly in the future (within clock skew)", async () => {
    const nearFutureTimestamp = Date.now() + 5_000;
    const payload = `${"/api/contact"}|${nearFutureTimestamp}|${"aa".repeat(16)}`;
    const payloadEncoded = btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const sigBytes = new Uint8Array(sigBuffer);
    const sigEncoded = btoa(String.fromCharCode(...sigBytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const token = `${payloadEncoded}.${sigEncoded}`;
    const result = await verifyCsrfToken(key, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("rejects a token with a future timestamp", async () => {
    const futureTimestamp = Date.now() + 3_600_000;
    const payload = `${"/api/contact"}|${futureTimestamp}|${"aa".repeat(16)}`;
    const payloadEncoded = btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const sigBytes = new Uint8Array(sigBuffer);
    const sigEncoded = btoa(String.fromCharCode(...sigBytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const token = `${payloadEncoded}.${sigEncoded}`;
    const result = await verifyCsrfToken(key, token, "/api/contact");
    expect(result).toEqual({ ok: false, reason: "future-timestamp" });
  });
});
