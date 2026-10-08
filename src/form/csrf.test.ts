import { beforeAll, describe, expect, it, spyOn } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import { Forge } from "../app/forge-app";
import type { AppContext } from "../context/types";
import { HMAC_DOMAIN, importKeyRing, importKeyRingUnder } from "../crypto/keyring/ring";
import { resolveKeyRingKey } from "../crypto/keyring/subkey";
import type { KeyRing } from "../crypto/keyring/types";
import { base64urlDecode, base64urlEncode, hmacSign, hmacVerify, utf8Decode, utf8Encode } from "../crypto/primitives/mod";
import { mapHandler } from "../testing/route";
import { createCsrfToken, csrfMinter, csrfMinterCtx, csrfProtection, csrfTokenCtx, mintCsrf, verifyCsrfToken } from "./csrf";
import { csrfHeaderCtx } from "./csrf-context";
import { parseFormData } from "./parse-form-data";

const HEX_KEY_A = "9c55dd3f0812c671dc6d905ab7941deebb36feefbbfe4ba28bd37ae08287a9cf";

const HEX_SECRET = "38f516127047072640d79f757593f8c971ed2324a5e1db688f6f129f9b0478db";
const HEX_KEY_B = "8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d";

function csrfSubkey(ring: KeyRing, kid: string = ring.activeKeyId): Promise<CryptoKey> {
  const key = resolveKeyRingKey(ring, { domain: HMAC_DOMAIN, kid, purpose: "csrf" }, "hmac");
  if (!key) throw new Error(`test ring has no key for "${kid}"`);
  return key;
}

async function signCsrfPayload(ring: KeyRing, payload: string, signingKid: string = ring.activeKeyId): Promise<string> {
  const sig = await hmacSign(await csrfSubkey(ring, signingKid), payload);
  return `${base64urlEncode(utf8Encode(payload))}.${base64urlEncode(sig)}`;
}

function csrfPayloadOf(token: string): string {
  return utf8Decode(base64urlDecode(token.slice(0, token.indexOf("."))));
}

describe("mintCsrf()", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  it("throws when no path argument is given", async () => {
    const app = new Forge();
    let caughtMessage: string | undefined;
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
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
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
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
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, "/api/submit")));
    const res = await app.request("/test");
    const token = await res.text();
    expect(token).not.toBe("");
    expect(token).toContain(".");
  });
});

describe("csrfProtection middleware", () => {
  let ring: KeyRing;

  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  function makeApp() {
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
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

  it("POST with a prototype-polluting kid in X-CSRF-Token returns 403, never 500", async () => {
    const app = makeApp();
    const forged = await signCsrfPayload(ring, `constructor|/test||${Date.now()}|${"aa".repeat(16)}`);
    const res = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": forged } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("POST with a prototype-polluting kid in the _csrf form field returns 403, never 500", async () => {
    const app = makeApp();
    const forged = await signCsrfPayload(ring, `toString|/test||${Date.now()}|${"aa".repeat(16)}`);
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: forged }).toString(),
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
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
    app.use("*", csrfProtection({ ring: () => ring, headerName: "X-My-Token", subject: false }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test");
    const token = await getRes.text();

    const res = await app.request("/test", { method: "POST", headers: { "X-My-Token": token } });
    expect(res.status).toBe(200);
  });

  // A passkey ceremony has no form and no hidden field to fall back to, so the header name has to
  // reach the builder that sends the token; disagreeing with the guard is a 403 with no explanation.
  it("publishes the header name it checks on a GET, custom or default", async () => {
    const named = new Forge();
    named.use("*", csrfProtection({ ring: () => ring, headerName: "X-My-Token", subject: false }));
    mapHandler(named, "GET", "/test", (c) => new Response(csrfHeaderCtx.get(c)));
    expect(await (await named.request("/test")).text()).toBe("X-My-Token");

    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfHeaderCtx.get(c)));
    expect(await (await app.request("/test")).text()).toBe("X-CSRF-Token");
  });

  it("publishes the header name on a mutation too", async () => {
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, headerName: "X-My-Token", subject: false }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.get(c)));
    mapHandler(app, "POST", "/test", (c) => new Response(csrfHeaderCtx.get(c)));

    const token = await (await app.request("/test")).text();
    const res = await app.request("/test", { method: "POST", headers: { "X-My-Token": token } });
    expect(await res.text()).toBe("X-My-Token");
  });

  it("GET sets csrf minter on context", async () => {
    let capturedMint: ((path: string) => Promise<string>) | undefined;
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
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
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
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
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
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

  it("a HEAD request mints csrfToken on context through the GET Forge rewrites it to", async () => {
    let capturedToken: string | undefined;
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
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
    app.use("*", csrfProtection({ ring: () => ring, subject: (c) => c.request.headers.get("x-session") ?? undefined }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test", { headers: { "x-session": "session-a" } });
    const token = await getRes.text();

    const res403 = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token, "x-session": "session-b" } });
    expect(res403.status).toBe(403);

    const res200 = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token, "x-session": "session-a" } });
    expect(res200.status).toBe(200);
  });

  it("subject resolver returning undefined — a mutation is refused rather than verified unbound", async () => {
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, subject: (c) => c.request.headers.get("x-session") ?? undefined }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const token = await (await app.request("/test")).text();
    const res = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("warns once per middleware instance when the subject resolver returns undefined", async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]));
    };
    try {
      const app = new Forge();
      app.use("*", csrfProtection({ ring: () => ring, subject: () => undefined }));
      mapHandler(app, "GET", "/test", () => new Response("ok"));
      mapHandler(app, "POST", "/test", () => new Response("ok"));

      await app.request("/test");
      await app.request("/test");
      await app.request("/test", { method: "POST" });
    } finally {
      console.warn = original;
    }

    expect(warnings.filter((w) => w.startsWith("[csrf]"))).toHaveLength(1);
  });

  it("subject: false — path-only token verifies regardless of session (no subject binding)", async () => {
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test", { headers: { "x-session": "session-a" } });
    const token = await getRes.text();

    const res = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token, "x-session": "session-b" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("middleware with key ring accepts tokens from both active and previous keys", async () => {
    const rotated = await importKeyRing([HEX_KEY_A, HEX_SECRET]);
    const oldToken = await createCsrfToken(ring, "/test");

    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => rotated, subject: false }));
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
    const ring = await importKeyRing([HEX_SECRET]);

    const app = new Forge<TestBindings>();
    app.use(
      "*",
      csrfProtection({
        ring: async (c) => {
          capturedSecret = (c as AppContext<TestBindings>).env.MY_SECRET;
          return ring;
        },
        subject: false,
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
    const ring = await importKeyRing([HEX_SECRET]);
    const sharedEnv = { CSRF_SECRET: HEX_SECRET };

    const app = new Forge();
    app.use(
      "*",
      csrfProtection({
        ring: async (_c) => {
          callCount++;
          return ring;
        },
        subject: false,
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

    expect(callCount).toBe(1);
  });

  it("re-resolves key for different env objects and rejects cross-env tokens", async () => {
    let callCount = 0;
    const ringA = await importKeyRing([HEX_KEY_A]);
    const ringB = await importKeyRing([HEX_SECRET]);
    const envA = { CSRF_SECRET: HEX_KEY_A };
    const envB = { CSRF_SECRET: HEX_SECRET };

    const app = new Forge();
    app.use(
      "*",
      csrfProtection({
        ring: async (c) => {
          callCount++;
          // oxlint-disable-next-line typescript/no-explicit-any -- test-only cast to read env secret
          return ((c as any).env as { CSRF_SECRET: string }).CSRF_SECRET === HEX_KEY_A ? ringA : ringB;
        },
        subject: false,
      }),
    );
    mapHandler(app, "GET", "/test", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test", undefined, envA);
    const tokenFromA = await getRes.text();
    expect(tokenFromA).toContain(".");

    const postRes = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": tokenFromA } }, envB);
    expect(postRes.status).toBe(403);

    expect(callCount).toBe(2);
  });
});

describe("CSRF token", () => {
  let ring: KeyRing;

  beforeAll(async () => {
    ring = await importKeyRing([HEX_KEY_A]);
  });

  it("round-trip succeeds", async () => {
    const token = await createCsrfToken(ring, "/api/contact");
    const result = await verifyCsrfToken(ring, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("carries the ring's active key id as the token's kid", async () => {
    const token = await createCsrfToken(ring, "/api/contact");
    expect(csrfPayloadOf(token).split("|")[0]).toBe(ring.activeKeyId);
  });

  it("rejects when path does not match", async () => {
    const token = await createCsrfToken(ring, "/api/contact");
    const result = await verifyCsrfToken(ring, token, "/api/other");
    expect(result).toEqual({ ok: false, error: "path-mismatch" });
  });

  it("rejects an expired token", async () => {
    const token = await createCsrfToken(ring, "/api/contact");
    const result = await verifyCsrfToken(ring, token, "/api/contact", { maxAgeMs: -1 });
    expect(result).toEqual({ ok: false, error: "expired" });
  });

  it("rejects a tampered signature", async () => {
    const token = await createCsrfToken(ring, "/api/contact");
    const [payload] = token.split(".");
    const result = await verifyCsrfToken(ring, `${payload}.aGVsbG8gd29ybGQ`, "/api/contact");
    expect(result).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("rejects a malformed token with no dot separator", async () => {
    const result = await verifyCsrfToken(ring, "notavalidtoken", "/api/contact");
    expect(result).toEqual({ ok: false, error: "invalid-format" });
  });

  it("rejects a token with empty payload segment", async () => {
    const result = await verifyCsrfToken(ring, ".aGVsbG8", "/api/contact");
    expect(result).toEqual({ ok: false, error: "invalid-format" });
  });

  it("rejects an empty token", async () => {
    const result = await verifyCsrfToken(ring, "", "/api/contact");
    expect(result).toEqual({ ok: false, error: "missing-token" });
  });

  it("accepts a token with a timestamp slightly in the future (within clock skew)", async () => {
    const token = await signCsrfPayload(ring, `${ring.activeKeyId}|/api/contact||${Date.now() + 5_000}|${"aa".repeat(16)}`);
    const result = await verifyCsrfToken(ring, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("rejects a token with a future timestamp", async () => {
    const token = await signCsrfPayload(ring, `${ring.activeKeyId}|/api/contact||${Date.now() + 3_600_000}|${"aa".repeat(16)}`);
    const result = await verifyCsrfToken(ring, token, "/api/contact");
    expect(result).toEqual({ ok: false, error: "future-timestamp" });
  });

  it("rejects a token whose kid is absent from the ring (unknown-key)", async () => {
    const token = await signCsrfPayload(ring, `AAAAAAAA|/api/contact||${Date.now()}|${"aa".repeat(16)}`);
    const result = await verifyCsrfToken(ring, token, "/api/contact");
    expect(result).toEqual({ ok: false, error: "unknown-key" });
  });

  // Kids naming an inherited Object.prototype member — the prototype-chain lookup these pin against.
  for (const pollutedKid of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    it(`rejects a token whose kid is the inherited member "${pollutedKid}" (unknown-key, not a throw)`, async () => {
      const token = await signCsrfPayload(ring, `${pollutedKid}|/api/contact||${Date.now()}|${"aa".repeat(16)}`);
      const result = await verifyCsrfToken(ring, token, "/api/contact");
      expect(result).toEqual({ ok: false, error: "unknown-key" });
    });
  }

  it("still resolves an own key whose id shadows an inherited member name", async () => {
    const shadowed: KeyRing = { activeKeyId: ring.activeKeyId, keys: { ...ring.keys, constructor: ring.keys[ring.activeKeyId]! } };
    const token = await signCsrfPayload(shadowed, `constructor|/api/contact||${Date.now()}|${"aa".repeat(16)}`, "constructor");
    const result = await verifyCsrfToken(shadowed, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("rejects a token with a tampered kid (invalid-signature)", async () => {
    const twoKeys = await importKeyRing([HEX_KEY_A, HEX_KEY_B]);
    const otherKid = Object.keys(twoKeys.keys).find((kid) => kid !== twoKeys.activeKeyId)!;

    const token = await createCsrfToken(twoKeys, "/api/contact");
    const tamperedPayload = csrfPayloadOf(token).replace(`${twoKeys.activeKeyId}|`, `${otherKid}|`);
    const tamperedToken = `${base64urlEncode(utf8Encode(tamperedPayload))}.${token.slice(token.indexOf(".") + 1)}`;

    const result = await verifyCsrfToken(twoKeys, tamperedToken, "/api/contact");
    expect(result).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("rejects a path containing pipe character", async () => {
    await expect(createCsrfToken(ring, "/a|b")).rejects.toThrow("CSRF path must not contain '|'");
  });

  it("rejects non-base64url signature as invalid-format", async () => {
    const token = await createCsrfToken(ring, "/api/contact");
    const [payload] = token.split(".");
    const result = await verifyCsrfToken(ring, `${payload}.!!!`, "/api/contact");
    expect(result).toEqual({ ok: false, error: "invalid-format" });
  });

  it("rejects a token with non-integer timestamp as expired", async () => {
    const token = await signCsrfPayload(ring, `${ring.activeKeyId}|/api/contact||notanumber|${"aa".repeat(16)}`);
    const result = await verifyCsrfToken(ring, token, "/api/contact");
    expect(result).toEqual({ ok: false, error: "expired" });
  });

  it("rejects a subject containing pipe character", async () => {
    await expect(createCsrfToken(ring, "/test", { subject: "a|b" })).rejects.toThrow("CSRF subject must not contain '|'");
  });

  it("round-trip with subject succeeds when subjects match", async () => {
    const token = await createCsrfToken(ring, "/api/contact", { subject: "session-abc" });
    const result = await verifyCsrfToken(ring, token, "/api/contact", { subject: "session-abc" });
    expect(result).toEqual({ ok: true });
  });

  it("rejects when subject at verify time differs from token subject", async () => {
    const token = await createCsrfToken(ring, "/api/contact", { subject: "session-abc" });
    const result = await verifyCsrfToken(ring, token, "/api/contact", { subject: "session-xyz" });
    expect(result).toEqual({ ok: false, error: "subject-mismatch" });
  });

  it("rejects when subject required at verify but token has no subject", async () => {
    const token = await createCsrfToken(ring, "/api/contact");
    const result = await verifyCsrfToken(ring, token, "/api/contact", { subject: "session-abc" });
    expect(result).toEqual({ ok: false, error: "subject-mismatch" });
  });

  it("accepts any subject when no subject given at verify time", async () => {
    const token = await createCsrfToken(ring, "/api/contact", { subject: "any-session" });
    const result = await verifyCsrfToken(ring, token, "/api/contact");
    expect(result).toEqual({ ok: true });
  });

  it("signs under the ring's csrf subkey, never the root key itself", async () => {
    const token = await createCsrfToken(ring, "/api/contact");
    const [payload, sig] = token.split(".") as [string, string];
    const root = await crypto.subtle.importKey("raw", ring.keys[ring.activeKeyId]!, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    expect(await hmacVerify(root, utf8Decode(base64urlDecode(payload)), base64urlDecode(sig))).toBe(false);
    expect(await hmacVerify(await csrfSubkey(ring), utf8Decode(base64urlDecode(payload)), base64urlDecode(sig))).toBe(true);
  });
});

describe("CSRF token wire format — a pinned vector", () => {
  const PINNED =
    "VHl6aWlCYkV8L2FwaS9jb250YWN0fHVzZXItMXwxNzkwMDAwMDAwMDAwfDBhYjJjNjMyZmMyNzQ5MWRmN2RjZjJkNDg4Yjg3MTA0.9dY1MMduKRZnTv3enpRJ-DndDwR8R336Uw3Hk2aAAL8";

  it("verifies a token minted under HEX_SECRET for /api/contact and subject user-1", async () => {
    const now = spyOn(Date, "now").mockReturnValue(1_790_000_000_000);
    try {
      expect(await verifyCsrfToken(await importKeyRing([HEX_SECRET]), PINNED, "/api/contact", { subject: "user-1" })).toEqual({ ok: true });
    } finally {
      now.mockRestore();
    }
  });
});

describe("CSRF token key-ring refusals", () => {
  const AUTH_DOMAIN = { keyIdLabel: "y-core/forge/test/auth/kid", subkeyLabel: "y-core/forge/test/auth/v1" };

  it("refuses to mint under the auth key ring", async () => {
    const authRing = await importKeyRingUnder("importAuthKeyRing", AUTH_DOMAIN, [HEX_SECRET]);
    await expect(createCsrfToken(authRing, "/api/contact")).rejects.toThrow(
      `createCsrfToken: active key id "${authRing.activeKeyId}" is not one importKeyRing derives`,
    );
  });

  it("refuses to verify under the auth key ring", async () => {
    const token = await createCsrfToken(await importKeyRing([HEX_SECRET]), "/api/contact");
    const authRing = await importKeyRingUnder("importAuthKeyRing", AUTH_DOMAIN, [HEX_SECRET]);
    await expect(verifyCsrfToken(authRing, token, "/api/contact")).rejects.toThrow(
      `verifyCsrfToken: active key id "${authRing.activeKeyId}" is not one importKeyRing derives`,
    );
  });

  it("refuses a ring holding no key for its active id", async () => {
    await expect(createCsrfToken({ activeKeyId: "AAAAAAAA", keys: {} }, "/api/contact")).rejects.toThrow("createCsrfToken:");
  });
});

describe("CSRF token rotation", () => {
  const secretNew = "0f328854bb8d3fe151893c6bb80e0298d42b867e556a95190618a51b75d8b8e9";
  const secretOld = "a4be059a6bf8f74efeb3c721902802870bb3aa5ec060fea9241d201f1e4e27d4";

  it("verifies a token minted before the rotation once the new secret is prepended", async () => {
    const before = await importKeyRing([secretOld]);
    const tokenOld = await createCsrfToken(before, "/form");

    const rotated = await importKeyRing([secretNew, secretOld]);
    const tokenNew = await createCsrfToken(rotated, "/form");

    expect(csrfPayloadOf(tokenNew).split("|")[0]).toBe(rotated.activeKeyId);
    expect(rotated.activeKeyId).not.toBe(before.activeKeyId);
    expect(await verifyCsrfToken(rotated, tokenNew, "/form")).toEqual({ ok: true });
    expect(await verifyCsrfToken(rotated, tokenOld, "/form")).toEqual({ ok: true });
  });

  it("refuses the old key's token once the old secret is dropped", async () => {
    const tokenOld = await createCsrfToken(await importKeyRing([secretOld]), "/form");
    const dropped = await importKeyRing([secretNew]);
    expect(await verifyCsrfToken(dropped, tokenOld, "/form")).toEqual({ ok: false, error: "unknown-key" });
  });
});

describe("csrfMinter()", () => {
  const env = { CSRF_SECRET: HEX_SECRET };

  function minterContext(bindings: object = env): RequestContext {
    const context = new RequestContext(new Request("http://localhost/"));
    Object.assign(context, { env: bindings });
    return context;
  }

  it("mints a token the guard for that path verifies, under the same subject", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const mint = csrfMinter({ ring: () => ring, subject: () => "sess-1" });

    const token = await mint(minterContext(), "/auth/signout");
    expect(await verifyCsrfToken(ring, token, "/auth/signout", { subject: "sess-1" })).toEqual({ ok: true });
  });

  it("binds the token to the subject, so another session's token is refused", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const mint = csrfMinter({ ring: () => ring, subject: () => "sess-1" });

    const token = await mint(minterContext(), "/auth/signout");
    expect(await verifyCsrfToken(ring, token, "/auth/signout", { subject: "sess-2" })).toEqual({ ok: false, error: "subject-mismatch" });
  });

  it("scopes the token to the path it was minted for, so it is refused on another", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const mint = csrfMinter({ ring: () => ring, subject: false });

    const token = await mint(minterContext(), "/auth/signout");
    expect(await verifyCsrfToken(ring, token, "/auth/signin")).toEqual({ ok: false, error: "path-mismatch" });
  });

  it("imports the key once per env, however many tokens are minted against it", async () => {
    let imports = 0;
    const mint = csrfMinter({
      ring: async () => {
        imports += 1;
        return importKeyRing([HEX_SECRET]);
      },
      subject: false,
    });

    const context = minterContext();
    await mint(context, "/auth/signout");
    await mint(minterContext(env), "/auth/signout");
    expect(imports).toBe(1);
  });

  it("re-imports for a different env, so one deployment's key never mints another's token", async () => {
    let imports = 0;
    const mint = csrfMinter({
      ring: async () => {
        imports += 1;
        return importKeyRing([HEX_SECRET]);
      },
      subject: false,
    });

    await mint(minterContext({ CSRF_SECRET: HEX_SECRET }), "/auth/signout");
    await mint(minterContext({ CSRF_SECRET: HEX_SECRET }), "/auth/signout");
    expect(imports).toBe(2);
  });

  it("refuses an empty path rather than minting a token bound to nothing", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const mint = csrfMinter({ ring: () => ring, subject: false });

    await expect(mint(minterContext(), "")).rejects.toThrow("csrfMinter: a non-empty action path is required to mint a CSRF token");
  });

  it("throws when the subject resolver returns nothing, rather than minting a token that must be refused", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const mint = csrfMinter({ ring: () => ring, subject: () => undefined });

    await expect(mint(minterContext(), "/auth/signout")).rejects.toThrow(
      "csrfMinter: the `subject` resolver returned undefined, so no token can be bound to a session. Register the session middleware, and register it BEFORE the mint — a resolver reading the session sees nothing when it runs first. Pass `subject: false` to opt out deliberately.",
    );
  });
});

describe("csrfProtection — body cap conflicts", () => {
  const body = (bytes: number) => `name=${"x".repeat(bytes)}`;

  // An earlier guard that swallows its own 413 is what leaves csrf holding a stream it cannot re-meter;
  // without the rethrow the refusal reads as 403, blaming a token that was never even looked for.
  it("rethrows a cap conflict to the error boundary instead of collapsing it to 403", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", async (c, next) => {
      await parseFormData(c, { maxBytes: 64 }).catch(() => {});
      return next();
    });
    app.use("*", csrfProtection({ ring: () => ring, subject: false, maxBytes: 5000 }));
    mapHandler(app, "POST", "/upload", () => new Response("ok"));

    const res = await app.request("/upload", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body(200) });
    expect(res.status).toBe(500);
  });

  it("still answers a genuine oversize body 413, with both caps at the same value", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, subject: false, maxBytes: 64 }));
    mapHandler(app, "POST", "/upload", () => new Response("ok"));

    const res = await app.request("/upload", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body(200) });
    expect(res.status).toBe(413);
  });

  it("serves a route with a raised cap normally while the body fits inside the smaller csrf cap", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, subject: false, maxBytes: 5000 }));
    mapHandler(app, "GET", "/mint", async (c) => new Response(await mintCsrf(c, "/upload")));
    mapHandler(app, "POST", "/upload", async (c) => {
      const fd = await parseFormData(c, { maxBytes: 50_000 });
      return new Response(fd.get("name") as string);
    });

    const token = await (await app.request("/mint")).text();
    const res = await app.request("/upload", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "X-CSRF-Token": token },
      body: "name=Alice",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Alice");
  });
});
