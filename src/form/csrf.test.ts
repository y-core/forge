import { beforeAll, describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import type { AppContext } from "../context/types";
import { createCsrfToken, csrfMinterCtx, csrfProtection, csrfTokenCtx, importCsrfKey, importCsrfKeyRing, mintCsrf, verifyCsrfToken } from "./csrf";
import { parseFormData } from "./parse-form-data";
import type { CsrfKeyRing } from "./types";

describe("importCsrfKey()", () => {
  it("rejects an odd-length hex string", async () => {
    await expect(importCsrfKey("a".repeat(63))).rejects.toThrow("CSRF secret must have an even number of hex characters");
  });

  it("rejects non-hex characters", async () => {
    await expect(importCsrfKey("zz".repeat(16))).rejects.toThrow("CSRF secret must contain only hexadecimal characters (0-9, a-f, A-F)");
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

describe("mintCsrf()", () => {
  let key: CryptoKey;
  beforeAll(async () => {
    key = await importCsrfKey(HEX_SECRET);
  });

  it("throws when no path argument is given", async () => {
    const app = new Forge();
    let caughtMessage: string | undefined;
    app.use("*", csrfProtection({ secret: () => key }));
    mapHandler(app, "GET", "/test", async (c) => {
      try {
        await mintCsrf(c);
        return new Response("no-throw");
      } catch (e) {
        caughtMessage = (e as Error).message;
        return new Response("threw");
      }
    });
    const res = await app.request("/test");
    expect(await res.text()).toBe("threw");
    expect(caughtMessage).toContain("non-empty action path is required");
  });

  it("mints a token for a path that verifies when POSTed to that path", async () => {
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key }));
    mapHandler(app, "GET", "/mint", async (c) => new Response(await mintCsrf(c, "/action")));
    mapHandler(app, "POST", "/action", () => new Response("ok"));

    const mintRes = await app.request("/mint");
    const token = await mintRes.text();

    const res = await app.request("/action", { method: "POST", headers: { "X-CSRF-Token": token } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("throws when path given but no minter on context", async () => {
    const app = new Forge();
    let caughtMessage: string | undefined;
    mapHandler(app, "GET", "/test", async (c) => {
      try {
        await mintCsrf(c, "/test");
        return new Response("no-throw");
      } catch (e) {
        caughtMessage = (e as Error).message;
        return new Response("threw");
      }
    });
    const res = await app.request("/test");
    expect(await res.text()).toBe("threw");
    expect(caughtMessage).toContain("no CSRF minter on context");
  });

  it("returns a dot-bearing token when minter is mounted", async () => {
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, "/api/submit")));
    const res = await app.request("/test");
    const token = await res.text();
    expect(token).not.toBe("");
    expect(token).toContain(".");
  });
});

describe("csrfProtection middleware", () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await importCsrfKey(HEX_SECRET);
  });

  function makeApp() {
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));
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

    const res = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("POST with invalid X-CSRF-Token header returns 403", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": "invalid.token" } });
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
    const res = await app.request("/test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "name=Jane" });
    expect(res.status).toBe(403);
  });

  it("respects custom headerName option", async () => {
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key, headerName: "X-My-Token" }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test");
    const token = await getRes.text();

    const res = await app.request("/test", { method: "POST", headers: { "X-My-Token": token } });
    expect(res.status).toBe(200);
  });

  it("GET sets csrf minter on context", async () => {
    let capturedMint: ((path: string) => Promise<string>) | undefined;
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key }));
    mapHandler(app, "GET", "/test", (c) => {
      capturedMint = csrfMinterCtx.getOptional(c);
      return new Response("ok");
    });
    await app.request("/test");
    expect(typeof capturedMint).toBe("function");
  });

  it("token minted with csrf for a specific path validates on that path", async () => {
    let capturedMint: ((path: string) => Promise<string>) | undefined;
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key }));
    mapHandler(app, "GET", "/contact", (c) => {
      capturedMint = csrfMinterCtx.getOptional(c);
      return new Response("ok");
    });
    mapHandler(app, "POST", "/api/contact", () => new Response("submitted"));

    await app.request("/contact");
    const apiToken = await capturedMint!("/api/contact");
    const res = await app.request("/api/contact", { method: "POST", headers: { "X-CSRF-Token": apiToken } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("submitted");
  });

  it("POST with _csrf form field — action handler reuses cached parseFormData", async () => {
    let captured: string | null = null;
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", async (c) => {
      const fd = await parseFormData(c);
      captured = fd.get("name") as string;
      return new Response("ok");
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

  it("HEAD mints csrfToken on context", async () => {
    let capturedToken: string | undefined;
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key }));
    mapHandler(app, "GET", "/test", (c) => {
      capturedToken = csrfTokenCtx.getOptional(c);
      return new Response("body");
    });
    const res = await app.request("/test", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(capturedToken).toBeDefined();
    expect(capturedToken).not.toBe("");
    expect(capturedToken).toContain(".");
  });

  it("subject binding — wrong session returns 403, matching session returns 200", async () => {
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key, subject: (c) => c.request.headers.get("x-session") ?? undefined }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test", { headers: { "x-session": "session-a" } });
    const token = await getRes.text();

    const res403 = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token, "x-session": "session-b" } });
    expect(res403.status).toBe(403);

    const res200 = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token, "x-session": "session-a" } });
    expect(res200.status).toBe(200);
  });

  it("middleware with key ring accepts tokens from both active and previous keys", async () => {
    const secret1 = "aa".repeat(32);
    const secret2 = "bb".repeat(32);
    const ring = await importCsrfKeyRing([secret1, secret2]);
    const oldRing = await importCsrfKeyRing([secret2]);

    const oldKey = oldRing.keys[oldRing.activeKeyId]!;
    const oldToken = await createCsrfToken(oldKey, "/test", { kid: oldRing.activeKeyId });

    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => ring }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test");
    const newToken = await getRes.text();
    const postNew = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": newToken } });
    expect(postNew.status).toBe(200);

    const postOld = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": oldToken } });
    expect(postOld.status).toBe(200);
  });
});

describe("csrfProtection middleware with typed resolver", () => {
  it("resolver receives typed context with custom Bindings", async () => {
    type TestBindings = { MY_SECRET: string };

    let capturedSecret: string | undefined;
    const key = await importCsrfKey(HEX_SECRET);

    const app = new Forge<TestBindings>();
    app.use(
      "*",
      csrfProtection<TestBindings>({
        secret: async (c) => {
          capturedSecret = (c as AppContext<TestBindings>).env.MY_SECRET;
          return key;
        },
      }),
    );
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));

    const res = await app.request("/test", undefined, { MY_SECRET: "test-value" });
    expect(res.status).toBe(200);
    expect(capturedSecret).toBe("test-value");
  });
});

describe("csrfProtection middleware with resolver secret", () => {
  it("resolves key via function, mints token on GET, validates on POST, and caches the key", async () => {
    let callCount = 0;
    const key = await importCsrfKey(HEX_SECRET);
    // A single shared env object — both requests must use the same reference to hit the cache.
    const sharedEnv = { CSRF_SECRET: HEX_SECRET };

    const app = new Forge();
    app.use(
      "*",
      csrfProtection({
        secret: async (_c) => {
          callCount++;
          return key;
        },
      }),
    );
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test", undefined, sharedEnv);
    expect(getRes.status).toBe(200);
    const token = await getRes.text();
    expect(token).toContain(".");

    const postRes = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token } }, sharedEnv);
    expect(postRes.status).toBe(200);
    expect(await postRes.text()).toBe("ok");

    expect(callCount).toBe(1); // same env object → single key import (cache hit on POST)
  });

  it("re-resolves key for different env objects and rejects cross-env tokens", async () => {
    let callCount = 0;
    const keyA = await importCsrfKey("a".repeat(64));
    const keyB = await importCsrfKey("b".repeat(64));
    const envA = { CSRF_SECRET: "a".repeat(64) };
    const envB = { CSRF_SECRET: "b".repeat(64) };

    const app = new Forge();
    app.use(
      "*",
      csrfProtection({
        secret: async (c) => {
          callCount++;
          // biome-ignore lint/suspicious/noExplicitAny: test-only cast to read env secret
          return ((c as any).env as { CSRF_SECRET: string }).CSRF_SECRET === "a".repeat(64) ? keyA : keyB;
        },
      }),
    );
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    // Mint a token under envA (signed by keyA).
    const getRes = await app.request("/test", undefined, envA);
    const tokenFromA = await getRes.text();
    expect(tokenFromA).toContain(".");

    // Replay that token under envB — must fail: keyB cannot verify a keyA signature.
    const postRes = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": tokenFromA } }, envB);
    expect(postRes.status).toBe(403);

    expect(callCount).toBe(2); // distinct env objects → resolver invoked once per env
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

  it("round-trip with explicit kid and ring succeeds", async () => {
    const token = await createCsrfToken(key, "/api/contact", { kid: "v2" });
    const ring: CsrfKeyRing = { activeKeyId: "v2", keys: { v2: key } };
    const result = await verifyCsrfToken(ring, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("rejects when path does not match", async () => {
    const token = await createCsrfToken(key, "/api/contact");
    const result = await verifyCsrfToken(key, token, "/api/other");
    expect(result).toEqual({ ok: false, reason: "path-mismatch" });
  });

  it("rejects an expired token", async () => {
    const token = await createCsrfToken(key, "/api/contact");
    const result = await verifyCsrfToken(key, token, "/api/contact", { maxAgeMs: -1 });
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
    const payload = `0|${"/api/contact"}||${nearFutureTimestamp}|${"aa".repeat(16)}`;
    const payloadEncoded = btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const sigBytes = new Uint8Array(sigBuffer);
    const sigEncoded = btoa(String.fromCharCode(...sigBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const token = `${payloadEncoded}.${sigEncoded}`;
    const result = await verifyCsrfToken(key, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("rejects a token with a future timestamp", async () => {
    const futureTimestamp = Date.now() + 3_600_000;
    const payload = `0|${"/api/contact"}||${futureTimestamp}|${"aa".repeat(16)}`;
    const payloadEncoded = btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const sigBytes = new Uint8Array(sigBuffer);
    const sigEncoded = btoa(String.fromCharCode(...sigBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const token = `${payloadEncoded}.${sigEncoded}`;
    const result = await verifyCsrfToken(key, token, "/api/contact");
    expect(result).toEqual({ ok: false, reason: "future-timestamp" });
  });

  it("rejects a token whose kid is absent from the ring (unknown-key)", async () => {
    const token = await createCsrfToken(key, "/api/contact", { kid: "orphan" });
    const ring: CsrfKeyRing = { activeKeyId: "v1", keys: { v1: key } };
    const result = await verifyCsrfToken(ring, token, "/api/contact");
    expect(result).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("rejects a token with a tampered kid (invalid-signature)", async () => {
    const key2 = await importCsrfKey("cc".repeat(32));
    const ring: CsrfKeyRing = { activeKeyId: "k1", keys: { k1: key, k2: key2 } };

    const token = await createCsrfToken(key, "/api/contact", { kid: "k1" });
    const dotIdx = token.indexOf(".");
    const payloadEncoded = token.slice(0, dotIdx);
    const sigEncoded = token.slice(dotIdx + 1);

    const payloadStr = new TextDecoder().decode(
      Uint8Array.from(atob(payloadEncoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    );
    const tamperedPayload = payloadStr.replace("k1|", "k2|");
    const tamperedEncoded = btoa(String.fromCharCode(...new TextEncoder().encode(tamperedPayload)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const tamperedToken = `${tamperedEncoded}.${sigEncoded}`;

    const result = await verifyCsrfToken(ring, tamperedToken, "/api/contact");
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("rejects a kid containing pipe character", async () => {
    await expect(createCsrfToken(key, "/test", { kid: "a|b" })).rejects.toThrow("CSRF key id must not contain '|'");
  });

  it("rejects a path containing pipe character", async () => {
    await expect(createCsrfToken(key, "/a|b")).rejects.toThrow("CSRF path must not contain '|'");
  });

  it("rejects non-base64url signature as invalid-format", async () => {
    const token = await createCsrfToken(key, "/api/contact");
    const [payload] = token.split(".");
    const result = await verifyCsrfToken(key, `${payload}.!!!`, "/api/contact");
    expect(result).toEqual({ ok: false, reason: "invalid-format" });
  });

  it("rejects a token with non-integer timestamp as expired", async () => {
    const payload = `0|/api/contact||notanumber|${"aa".repeat(16)}`;
    const payloadEncoded = btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const sigBytes = new Uint8Array(sigBuffer);
    const sigEncoded = btoa(String.fromCharCode(...sigBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const result = await verifyCsrfToken(key, `${payloadEncoded}.${sigEncoded}`, "/api/contact");
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a subject containing pipe character", async () => {
    await expect(createCsrfToken(key, "/test", { subject: "a|b" })).rejects.toThrow("CSRF subject must not contain '|'");
  });

  it("round-trip with subject succeeds when subjects match", async () => {
    const token = await createCsrfToken(key, "/api/contact", { subject: "session-abc" });
    const result = await verifyCsrfToken(key, token, "/api/contact", { subject: "session-abc" });
    expect(result).toEqual({ ok: true });
  });

  it("rejects when subject at verify time differs from token subject", async () => {
    const token = await createCsrfToken(key, "/api/contact", { subject: "session-abc" });
    const result = await verifyCsrfToken(key, token, "/api/contact", { subject: "session-xyz" });
    expect(result).toEqual({ ok: false, reason: "subject-mismatch" });
  });

  it("rejects when subject required at verify but token has no subject", async () => {
    const token = await createCsrfToken(key, "/api/contact");
    const result = await verifyCsrfToken(key, token, "/api/contact", { subject: "session-abc" });
    expect(result).toEqual({ ok: false, reason: "subject-mismatch" });
  });

  it("accepts any subject when no subject given at verify time", async () => {
    const token = await createCsrfToken(key, "/api/contact", { subject: "any-session" });
    const result = await verifyCsrfToken(key, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });
});

describe("CSRF token rotation overlap", () => {
  it("ring with active and previous keys verifies tokens from both", async () => {
    const secretNew = "dd".repeat(32);
    const secretOld = "ee".repeat(32);
    const ring = await importCsrfKeyRing([secretNew, secretOld]);

    const newKey = ring.keys[ring.activeKeyId]!;
    const tokenNew = await createCsrfToken(newKey, "/form", { kid: ring.activeKeyId });

    const oldRing = await importCsrfKeyRing([secretOld]);
    const oldKey = oldRing.keys[oldRing.activeKeyId]!;
    const tokenOld = await createCsrfToken(oldKey, "/form", { kid: oldRing.activeKeyId });

    expect(await verifyCsrfToken(ring, tokenNew, "/form")).toEqual({ ok: true });
    expect(await verifyCsrfToken(ring, tokenOld, "/form")).toEqual({ ok: true });
  });
});

describe("importCsrfKeyRing()", () => {
  it("activeKeyId is the first secret's kid", async () => {
    const ring = await importCsrfKeyRing(["aa".repeat(32), "bb".repeat(32)]);
    const firstOnly = await importCsrfKeyRing(["aa".repeat(32)]);
    expect(ring.activeKeyId).toBe(firstOnly.activeKeyId);
  });

  it("derives stable kids — same secret produces same kid across calls", async () => {
    const ring1 = await importCsrfKeyRing(["cc".repeat(32)]);
    const ring2 = await importCsrfKeyRing(["cc".repeat(32)]);
    expect(ring1.activeKeyId).toBe(ring2.activeKeyId);
  });

  it("ring built from [s1, s2] verifies tokens minted by either key", async () => {
    const s1 = "11".repeat(32);
    const s2 = "22".repeat(32);
    const ring = await importCsrfKeyRing([s1, s2]);

    const kids = Object.keys(ring.keys);
    expect(kids.length).toBe(2);

    for (const kid of kids) {
      const token = await createCsrfToken(ring.keys[kid]!, "/test", { kid });
      const result = await verifyCsrfToken(ring, token, "/test");
      expect(result).toEqual({ ok: true });
    }
  });

  it("different secrets produce different kids", async () => {
    const ring = await importCsrfKeyRing(["aa".repeat(32), "bb".repeat(32)]);
    const kids = Object.keys(ring.keys);
    expect(kids[0]).not.toBe(kids[1]);
  });
});
