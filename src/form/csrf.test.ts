import { afterEach, beforeAll, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import type { Middleware } from "@remix-run/fetch-router";

import { Forge } from "../app/forge-app";
import { applyMiddlewareChain } from "../app/middleware-chain";
import { contextVar } from "../context/accessor";
import { refuseHookCtx } from "../context/refusal";
import type { Refusal, RefuseHook } from "../context/types";
import { createKeyRingResolver } from "../crypto/keyring/resolver";
import { HMAC_DOMAIN, importKeyRing, importKeyRingUnder } from "../crypto/keyring/ring";
import { resolveKeyRingKey } from "../crypto/keyring/subkey";
import type { KeyRing, KeyRingResolver } from "../crypto/keyring/types";
import { base64urlDecode, base64urlEncode, hmacSign, hmacVerify, utf8Decode, utf8Encode } from "../crypto/primitives/mod";
import { requestLog } from "../logging/request-logger";
import { requestId } from "../security/request-id";
import { createTestContext } from "../testing/context";
import { captureLogs } from "../testing/logs";
import { mapHandler } from "../testing/route";
import { createCsrfToken, csrfMinterCtx, csrfMintStage, csrfVerifyStage, mintCsrf, verifyCsrfToken } from "./csrf";
import { csrfFieldCtx, csrfHeaderCtx } from "./csrf-context";
import { parseFormData } from "./parse-form-data";
import type { CsrfFailure, CsrfPolicyOptions } from "./types";

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

function publishRefuseHook(app: Forge, hook: RefuseHook): void {
  app.use("*", (context, next) => {
    refuseHookCtx.set(context, hook);
    return next();
  });
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
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
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
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/mint", async (c) => new Response(await mintCsrf(c, "/action")));
    mapHandler(app, "POST", "/action", () => new Response("ok"));

    const mintRes = await app.request("/mint");
    const token = await mintRes.text();

    const res = await app.request("/action", { method: "POST", headers: { "X-CSRF-Token": token } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("refuses an empty path rather than minting a token bound to nothing", async () => {
    const context = createTestContext(new Request("http://localhost/"));
    await csrfMintStage({ ring: () => ring, subject: false })(context, () => Promise.resolve(new Response()));

    await expect(mintCsrf(context, "")).rejects.toThrow("non-empty action path is required");
  });

  it("scopes the token to the path it was minted for, so the policy refuses it on another", async () => {
    const app = new Forge();
    publishRefuseHook(app, (_c, refusal) => Response.json(refusal, { status: refusal.status }));
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/mint", async (c) => new Response(await mintCsrf(c, "/auth/signout")));
    mapHandler(app, "POST", "/auth/signin", () => new Response("signed in"));

    const token = await (await app.request("/mint")).text();
    const res = await app.request("/auth/signin", { method: "POST", headers: { "X-CSRF-Token": token } });

    expect({ status: res.status, body: await res.json() }).toEqual({ status: 403, body: { guard: "csrf", status: 403, reason: "path-mismatch" } });
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
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, "/api/submit")));
    const res = await app.request("/test");
    const token = await res.text();
    expect(token).not.toBe("");
    expect(token).toContain(".");
  });
});

describe("csrfMintStage, verified in the router's final stage", () => {
  let ring: KeyRing;

  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  function makeApp() {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
    mapHandler(app, "POST", "/test", () => new Response("ok"));
    return app;
  }

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
    expect(await res.text()).toBe("Forbidden");
  });

  it("holds OPTIONS and TRACE to a token, exempting only GET and HEAD", async () => {
    const app = makeApp();
    mapHandler(app, "ANY", "/any", () => new Response("ok"));

    for (const method of ["OPTIONS", "TRACE"]) {
      const res = await app.request("/any", { method });
      expect({ method, status: res.status, body: await res.text() }).toEqual({ method, status: 403, body: "Forbidden" });
    }
  });

  it("OPTIONS with a valid X-CSRF-Token header passes", async () => {
    const app = makeApp();
    mapHandler(app, "ANY", "/any", () => new Response("ok"));
    const token = await createCsrfToken(ring, "/any");

    const res = await app.request("/any", { method: "OPTIONS", headers: { "X-CSRF-Token": token } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("leaves a CORS preflight, OPTIONS with Origin and Access-Control-Request-Method, unarmed", async () => {
    const app = makeApp();
    mapHandler(app, "ANY", "/any", () => new Response("ok"));

    const res = await app.request("/any", {
      method: "OPTIONS",
      headers: { Origin: "https://partner.example.com", "Access-Control-Request-Method": "POST" },
    });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 200, body: "ok" });
  });

  it("holds a bare OPTIONS, and one carrying Origin or Access-Control-Request-Method alone, to a token", async () => {
    const app = makeApp();
    mapHandler(app, "ANY", "/any", () => new Response("ok"));
    const cases: { name: string; headers: Record<string, string> }[] = [
      { name: "bare", headers: {} },
      { name: "Origin only", headers: { Origin: "https://partner.example.com" } },
      { name: "Access-Control-Request-Method only", headers: { "Access-Control-Request-Method": "POST" } },
    ];

    for (const { name, headers } of cases) {
      const res = await app.request("/any", { method: "OPTIONS", headers });
      expect({ name, status: res.status, body: await res.text() }).toEqual({ name, status: 403, body: "Forbidden" });
    }
  });

  it("respects custom headerName option", async () => {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, headerName: "X-My-Token", subject: false }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test");
    const token = await getRes.text();

    const res = await app.request("/test", { method: "POST", headers: { "X-My-Token": token } });
    expect(res.status).toBe(200);
  });

  it("publishes the header name it checks on a GET, custom or default", async () => {
    const named = new Forge();
    named.use("*", csrfMintStage({ ring: () => ring, headerName: "X-My-Token", subject: false }));
    mapHandler(named, "GET", "/test", (c) => new Response(csrfHeaderCtx.get(c)));
    expect(await (await named.request("/test")).text()).toBe("X-My-Token");

    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/test", (c) => new Response(csrfHeaderCtx.get(c)));
    expect(await (await app.request("/test")).text()).toBe("X-CSRF-Token");
  });

  it("publishes the header name on a mutation too", async () => {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, headerName: "X-My-Token", subject: false }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
    mapHandler(app, "POST", "/test", (c) => new Response(csrfHeaderCtx.get(c)));

    const token = await (await app.request("/test")).text();
    const res = await app.request("/test", { method: "POST", headers: { "X-My-Token": token } });
    expect(await res.text()).toBe("X-My-Token");
  });

  it("publishes the token field name it consumed on a mutation", async () => {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, tokenField: "my_csrf", subject: false }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
    mapHandler(app, "POST", "/test", (c) => new Response(csrfFieldCtx.get(c)));

    const token = await (await app.request("/test")).text();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ my_csrf: token }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("my_csrf");
  });

  it("GET sets csrf minter on context", async () => {
    let capturedMint: ((path: string) => Promise<string>) | undefined;
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
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
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
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
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
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

  it("a HEAD request's handler can mint through the GET Forge rewrites it to", async () => {
    let capturedToken: string | undefined;
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/test", async (c) => {
      capturedToken = await mintCsrf(c, "/test");
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
    app.use("*", csrfMintStage({ ring: () => ring, subject: (c) => c.request.headers.get("x-session") ?? undefined }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
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
    app.use("*", csrfMintStage({ ring: () => ring, subject: (c) => c.request.headers.get("x-session") ?? undefined }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
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
      app.use("*", csrfMintStage({ ring: () => ring, subject: () => undefined }));
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

  it("a GET whose handler mints nothing never calls the subject resolver", async () => {
    let calls = 0;
    const app = new Forge();
    app.use(
      "*",
      csrfMintStage({
        ring: () => ring,
        subject: () => {
          calls += 1;
          return "session-a";
        },
      }),
    );
    mapHandler(app, "GET", "/test", () => new Response("page"));

    const res = await app.request("/test");
    expect(await res.text()).toBe("page");
    expect(calls).toBe(0);
  });

  it("a GET resolves the subject once however many tokens its handler mints", async () => {
    let calls = 0;
    const app = new Forge();
    app.use(
      "*",
      csrfMintStage({
        ring: () => ring,
        subject: () => {
          calls += 1;
          return "session-a";
        },
      }),
    );
    mapHandler(app, "GET", "/test", async (c) => Response.json([await mintCsrf(c, "/test"), await mintCsrf(c, "/other")]));

    const [first, second] = (await (await app.request("/test")).json()) as [string, string];
    expect(calls).toBe(1);
    expect(await verifyCsrfToken(ring, first, "/test", { subject: "session-a" })).toEqual({ ok: true });
    expect(await verifyCsrfToken(ring, second, "/other", { subject: "session-a" })).toEqual({ ok: true });
  });

  it("a GET binds the token to the subject a later middleware publishes before the mint", async () => {
    const lateSubject = contextVar<string>("csrf-test-late-subject");
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: (c) => lateSubject.getOptional(c) }));
    app.use("*", async (c, next) => {
      lateSubject.set(c, "published-late");
      return next();
    });
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, "/test")));

    const token = await (await app.request("/test")).text();
    expect(await verifyCsrfToken(ring, token, "/test", { subject: "published-late" })).toEqual({ ok: true });
  });

  it("a mutation resolves the subject once, before its handler runs", async () => {
    let calls = 0;
    let callsWhenHandlerRan = -1;
    const app = new Forge();
    app.use(
      "*",
      csrfMintStage({
        ring: () => ring,
        subject: () => {
          calls += 1;
          return "session-a";
        },
      }),
    );
    mapHandler(app, "POST", "/test", async (c) => {
      callsWhenHandlerRan = calls;
      return new Response(await mintCsrf(c, "/test"));
    });

    const token = await createCsrfToken(ring, "/test", { subject: "session-a" });
    const res = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token } });
    expect(res.status).toBe(200);
    expect(callsWhenHandlerRan).toBe(1);
    expect(calls).toBe(1);
  });

  it("a GET that mints under an undefined subject warns once", async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]));
    };
    try {
      const app = new Forge();
      app.use("*", csrfMintStage({ ring: () => ring, subject: () => undefined }));
      mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, "/test")));

      await app.request("/test");
      await app.request("/test");
    } finally {
      console.warn = original;
    }

    expect(warnings.filter((w) => w.startsWith("[csrf]"))).toHaveLength(1);
  });

  it("subject: false — path-only token verifies regardless of session (no subject binding)", async () => {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
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
    app.use("*", csrfMintStage({ ring: () => rotated, subject: false }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
    mapHandler(app, "POST", "/test", () => new Response("ok"));

    const getRes = await app.request("/test");
    const newToken = await getRes.text();
    const postNew = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": newToken } });
    expect(postNew.status).toBe(200);

    const postOld = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": oldToken } });
    expect(postOld.status).toBe(200);
  });
});

describe("csrfMintStage, verified in the router's final stage, with typed resolver", () => {
  it("resolver receives the env with custom Bindings", async () => {
    type TestBindings = { MY_SECRET: string };

    let capturedSecret: string | undefined;
    const ring = await importKeyRing([HEX_SECRET]);

    const app = new Forge<TestBindings>();
    app.use(
      "*",
      csrfMintStage({
        ring: async (env: TestBindings) => {
          capturedSecret = env.MY_SECRET;
          return ring;
        },
        subject: false,
      }),
    );
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));

    const res = await app.request("/test", undefined, { MY_SECRET: "test-value" });
    expect(res.status).toBe(200);
    expect(capturedSecret).toBe("test-value");
  });
});

describe("csrfMintStage, verified in the router's final stage, with resolver secret", () => {
  it("resolves key via function, mints token on GET, validates on POST, and caches the key", async () => {
    let callCount = 0;
    const ring = await importKeyRing([HEX_SECRET]);
    const sharedEnv = { CSRF_SECRET: HEX_SECRET };

    const app = new Forge();
    app.use(
      "*",
      csrfMintStage({
        ring: async (_c) => {
          callCount++;
          return ring;
        },
        subject: false,
      }),
    );
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
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
      csrfMintStage({
        ring: async (env: { CSRF_SECRET: string }) => {
          callCount++;
          return env.CSRF_SECRET === HEX_KEY_A ? ringA : ringB;
        },
        subject: false,
      }),
    );
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
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

describe("csrfMintStage — body cap conflicts", () => {
  const body = (bytes: number) => `name=${"x".repeat(bytes)}`;

  it("rethrows a cap conflict to the error boundary instead of collapsing it to 403", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", async (c, next) => {
      await parseFormData(c, { maxBytes: 64 }).catch(() => {});
      return next();
    });
    app.use("*", csrfMintStage({ ring: () => ring, subject: false, maxBytes: 5000 }));
    mapHandler(app, "POST", "/upload", () => new Response("ok"));

    const res = await app.request("/upload", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body(200) });
    expect(res.status).toBe(500);
  });

  it("still answers a genuine oversize body 413, with both caps at the same value", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false, maxBytes: 64 }));
    mapHandler(app, "POST", "/upload", () => new Response("ok"));

    const res = await app.request("/upload", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body(200) });
    expect(res.status).toBe(413);
  });

  it("serves a route with a raised cap normally while the body fits inside the smaller csrf cap", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false, maxBytes: 5000 }));
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

describe("csrfMintStage — the refusal hook in force", () => {
  const STALE_MS = 25 * 3_600_000;
  const BEYOND_SKEW_MS = 10 * 60_000;
  const NONCE = "aa".repeat(16);
  let ring: KeyRing;

  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  function makeApp(hook: RefuseHook) {
    const app = new Forge();
    publishRefuseHook(app, hook);
    app.use("*", csrfMintStage({ ring: () => ring, subject: (c) => c.request.headers.get("x-session") ?? undefined, maxBytes: 64 }));
    mapHandler(app, "GET", "/test", async (c) => new Response(await mintCsrf(c, c.url.pathname)));
    mapHandler(app, "POST", "/test", () => new Response("ok"));
    return app;
  }

  function recordingHook() {
    const calls: Array<{ path: string; refusal: Refusal }> = [];
    const hook: RefuseHook = (c, refusal) => {
      calls.push({ path: c.url.pathname, refusal });
      return new Response(`refused: ${"reason" in refusal ? refusal.reason : refusal.guard}`, { status: 418 });
    };
    return { calls, hook };
  }

  const tokenRefusals: Array<{ reason: CsrfFailure; token: () => Promise<string | undefined> }> = [
    { reason: "missing-token", token: async () => undefined },
    { reason: "invalid-format", token: async () => "no-dot" },
    {
      reason: "invalid-signature",
      token: async () => `${(await createCsrfToken(ring, "/test", { subject: "session-a" })).split(".")[0]}.aGVsbG8gd29ybGQ`,
    },
    { reason: "path-mismatch", token: () => createCsrfToken(ring, "/other", { subject: "session-a" }) },
    { reason: "subject-mismatch", token: () => createCsrfToken(ring, "/test", { subject: "session-b" }) },
    { reason: "unknown-key", token: async () => createCsrfToken(await importKeyRing([HEX_KEY_A]), "/test", { subject: "session-a" }) },
    { reason: "expired", token: () => signCsrfPayload(ring, `${ring.activeKeyId}|/test|session-a|${Date.now() - STALE_MS}|${NONCE}`) },
    {
      reason: "future-timestamp",
      token: () => signCsrfPayload(ring, `${ring.activeKeyId}|/test|session-a|${Date.now() + BEYOND_SKEW_MS}|${NONCE}`),
    },
  ];

  for (const { reason, token } of tokenRefusals) {
    it(`hands a "${reason}" refusal to the hook as a csrf 403, answering with the hook's response`, async () => {
      const { calls, hook } = recordingHook();
      const value = await token();
      const res = await makeApp(hook).request("/test", {
        method: "POST",
        headers: { "x-session": "session-a", ...(value !== undefined ? { "X-CSRF-Token": value } : {}) },
      });
      expect({ status: res.status, body: await res.text(), calls }).toEqual({
        status: 418,
        body: `refused: ${reason}`,
        calls: [{ path: "/test", refusal: { guard: "csrf", status: 403, reason } }],
      });
    });
  }

  it('hands an "unbound-subject" refusal to the hook as a csrf 403', async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { calls, hook } = recordingHook();
      const app = makeApp(hook);
      const token = await (await app.request("/test")).text();
      const res = await app.request("/test", { method: "POST", headers: { "X-CSRF-Token": token } });
      expect({ status: res.status, body: await res.text(), calls }).toEqual({
        status: 418,
        body: "refused: unbound-subject",
        calls: [{ path: "/test", refusal: { guard: "csrf", status: 403, reason: "unbound-subject" } }],
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("awaits an async hook and returns the response it resolves to", async () => {
    const app = makeApp(async (_c, refusal) => {
      await Promise.resolve();
      return new Response(`later: ${"reason" in refusal ? refusal.reason : refusal.guard}`, { status: 409 });
    });
    const res = await app.request("/test", { method: "POST", headers: { "x-session": "session-a", "X-CSRF-Token": "no-dot" } });
    expect(res.status).toBe(409);
    expect(await res.text()).toBe("later: invalid-format");
  });

  it("never calls the hook on a valid POST, which reaches the handler", async () => {
    const { calls, hook } = recordingHook();
    const app = makeApp(hook);
    const token = await (await app.request("/test", { headers: { "x-session": "session-a" } })).text();
    const res = await app.request("/test", { method: "POST", headers: { "x-session": "session-a", "X-CSRF-Token": token } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(calls).toEqual([]);
  });

  it("never calls the hook on a GET, even with no session to bind to", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { calls, hook } = recordingHook();
      const res = await makeApp(hook).request("/test");
      expect(res.status).toBe(200);
      expect(calls).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("hands an oversized body to the hook as a csrf 413 too-large", async () => {
    const { calls, hook } = recordingHook();
    const res = await makeApp(hook).request("/test", {
      method: "POST",
      headers: { "x-session": "session-a", "content-type": "application/x-www-form-urlencoded" },
      body: `name=${"x".repeat(200)}`,
    });
    expect({ status: res.status, body: await res.text(), calls }).toEqual({
      status: 418,
      body: "refused: too-large",
      calls: [{ path: "/test", refusal: { guard: "csrf", status: 413, reason: "too-large" } }],
    });
  });

  it("hands a tokenless body it cannot read as a form to the hook as a csrf 400 unreadable-body", async () => {
    const { calls, hook } = recordingHook();
    const res = await makeApp(hook).request("/test", {
      method: "POST",
      headers: { "x-session": "session-a", "content-type": "application/json" },
      body: JSON.stringify({ _csrf: "irrelevant" }),
    });
    expect({ status: res.status, body: await res.text(), calls }).toEqual({
      status: 418,
      body: "refused: unreadable-body",
      calls: [{ path: "/test", refusal: { guard: "csrf", status: 400, reason: "unreadable-body" } }],
    });
  });

  it("passes a body it cannot read as a form when the header carries a valid token, never parsing it", async () => {
    const { calls, hook } = recordingHook();
    const app = makeApp(hook);
    const token = await (await app.request("/test", { headers: { "x-session": "session-a" } })).text();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "x-session": "session-a", "content-type": "application/json", "X-CSRF-Token": token },
      body: "{}",
    });
    expect({ status: res.status, body: await res.text(), calls }).toEqual({ status: 200, body: "ok", calls: [] });
  });

  it("rethrows a cap conflict to the error boundary without calling the hook", async () => {
    const { calls, hook } = recordingHook();
    const app = new Forge();
    publishRefuseHook(app, hook);
    app.use("*", async (c, next) => {
      await parseFormData(c, { maxBytes: 64 }).catch(() => {});
      return next();
    });
    app.use("*", csrfMintStage({ ring: () => ring, subject: false, maxBytes: 5000 }));
    mapHandler(app, "POST", "/upload", () => new Response("ok"));

    const res = await app.request("/upload", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `name=${"x".repeat(200)}`,
    });
    expect(res.status).toBe(500);
    expect(calls).toEqual([]);
  });
});

describe("csrfMintStage — with no refusal hook declared", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  function plainApp() {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false, maxBytes: 64 }));
    mapHandler(app, "POST", "/test", () => new Response("ok"));
    return app;
  }

  const cases: Array<{ name: string; init: RequestInit; expected: { status: number; body: string } }> = [
    {
      name: "a bad token 403 Forbidden",
      init: { method: "POST", headers: { "X-CSRF-Token": "no-dot" } },
      expected: { status: 403, body: "Forbidden" },
    },
    {
      name: "an oversized body 413 Payload Too Large",
      init: { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `name=${"x".repeat(200)}` },
      expected: { status: 413, body: "Payload Too Large" },
    },
    {
      name: "a body it cannot read as a form 400 Bad Request",
      init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      expected: { status: 400, body: "Bad Request" },
    },
  ];

  for (const { name, init, expected } of cases) {
    it(`answers ${name}`, async () => {
      const res = await plainApp().request("/test", init);
      expect({ status: res.status, body: await res.text() }).toEqual(expected);
    });
  }
});

describe("csrfMintStage — the refusal log", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  it("logs security.csrf.refused at warn with the guard, status, reason, route and request id, and no token, session or address", async () => {
    const capture = captureLogs();
    const app = new Forge();
    app.use("*", requestId());
    app.use("*", (context, next) => {
      requestLog.set(context, capture.logger);
      return next();
    });
    app.use("*", csrfMintStage({ ring: () => ring, subject: (c) => c.request.headers.get("x-session") ?? undefined }));
    mapHandler(app, "POST", "/items/:id", () => new Response("ok"));
    const token = await createCsrfToken(ring, "/items/7", { subject: "session-b" });

    const res = await app.request("/items/7", {
      method: "POST",
      headers: { "x-session": "session-a", "X-CSRF-Token": token, "CF-Connecting-IP": "203.0.113.9" },
    });
    const id = res.headers.get("x-request-id");

    expect({ status: res.status, logged: capture.records.map(({ level, message, data }) => ({ level, message, data })) }).toEqual({
      status: 403,
      logged: [
        {
          level: "warn",
          message: "security.csrf.refused",
          data: { source: "security", guard: "csrf", status: 403, reason: "subject-mismatch", routePattern: "/items/:id", requestId: id },
        },
      ],
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/** What one app saw, in order: ring resolutions, body reads, refusals, handler runs. */
function stagedWorld(resolveRing: () => KeyRing | Promise<KeyRing>) {
  const events: string[] = [];
  const options: CsrfPolicyOptions = {
    ring: () => {
      events.push("ring");
      return resolveRing();
    },
    subject: false,
  };
  const refuse = (_context: unknown, refusal: Refusal): Response => {
    const reason = "reason" in refusal ? refusal.reason : refusal.guard;
    events.push(`refused:${reason}`);
    return new Response(`refused: ${reason}`, { status: refusal.status });
  };
  const post = (headers: Record<string, string> = {}): RequestInit =>
    ({
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new ReadableStream(
        {
          pull(controller) {
            events.push("body");
            controller.enqueue(utf8Encode("name=Ada"));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: "half",
    }) as RequestInit;
  const app = new Forge();
  app.setOnError((error) => new Response(error.message, { status: 500 }));
  publishRefuseHook(app, refuse);
  return { events, options, refuse, post, app };
}

const swapTokenHeader: Middleware = async (context, next) => {
  context.request.headers.set("x-csrf-token", "forged.token");
  return next();
};

const failingRing = () => Promise.reject(new Error("ring unavailable"));

describe("csrfMintStage", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  it("publishes the minter, field and header on a GET, resolving the ring only once a token is minted", async () => {
    const world = stagedWorld(() => ring);
    world.app.use("*", csrfMintStage({ ...world.options, tokenField: "_token", headerName: "x-token" }));
    mapHandler(world.app, "GET", "/plain", (c) => Response.json({ field: csrfFieldCtx.getOptional(c), header: csrfHeaderCtx.getOptional(c) }));
    mapHandler(world.app, "GET", "/form", async (c) => new Response(await mintCsrf(c, "/save")));

    const plain = await (await world.app.request("/plain")).json();
    const eventsBeforeMint = [...world.events];
    const token = await (await world.app.request("/form")).text();

    expect({ plain, eventsBeforeMint, eventsAfterMint: world.events, verdict: await verifyCsrfToken(ring, token, "/save") }).toEqual({
      plain: { field: "_token", header: "x-token" },
      eventsBeforeMint: [],
      eventsAfterMint: ["ring"],
      verdict: { ok: true },
    });
  });

  it("arms a mutation's check without running it, leaving it to the router's final stage", async () => {
    const world = stagedWorld(() => ring);
    let seenByNextMiddleware: string[] | undefined;
    world.app.use("*", csrfMintStage(world.options), async (_c, next) => {
      seenByNextMiddleware = [...world.events];
      return next();
    });
    mapHandler(world.app, "POST", "/save", () => {
      world.events.push("handler");
      return new Response("saved");
    });

    const res = await world.app.request("/save", world.post());

    expect({ status: res.status, body: await res.text(), seenByNextMiddleware, events: world.events }).toEqual({
      status: 403,
      body: "refused: missing-token",
      seenByNextMiddleware: [],
      events: ["body", "ring", "refused:missing-token"],
    });
  });

  it("serves a GET that mints nothing while its ring cannot be resolved", async () => {
    const world = stagedWorld(failingRing);
    world.app.use("*", csrfMintStage(world.options));
    mapHandler(world.app, "GET", "/page", () => new Response("page"));

    const res = await world.app.request("/page");

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({ status: 200, body: "page", events: [] });
  });

  it("fails a GET that mints while its ring cannot be resolved", async () => {
    const world = stagedWorld(failingRing);
    world.app.use("*", csrfMintStage(world.options));
    mapHandler(world.app, "GET", "/page", async (c) => new Response(await mintCsrf(c, "/save")));

    const res = await world.app.request("/page");

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 500,
      body: "ring unavailable",
      events: ["ring"],
    });
  });
  it("fails a mutation under an unresolvable ring only after reading the body's token", async () => {
    const world = stagedWorld(failingRing);
    world.app.use("*", csrfMintStage(world.options));
    mapHandler(world.app, "POST", "/save", () => new Response("saved"));

    const res = await world.app.request("/save", world.post());

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 500,
      body: "ring unavailable",
      events: ["body", "ring"],
    });
  });

  it('throws at construction on subject "session", which only applyMiddlewareChain resolves', () => {
    expect(() => csrfMintStage({ ring: () => ring, subject: "session" })).toThrow(
      new Error(
        'csrfMintStage: subject "session" is resolved by applyMiddlewareChain\'s `csrf` policy; mounted by hand, pass a resolver reading the session.',
      ),
    );
  });
});

describe("csrfMintStage — an isUnbound predicate", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  function unboundWorld() {
    const world = stagedWorld(() => ring);
    const asked: string[] = [];
    const options: CsrfPolicyOptions = {
      ...world.options,
      subject: (c) => {
        world.events.push("subject");
        return c.request.headers.get("x-session") ?? undefined;
      },
    };
    const isUnbound = (target: URL): boolean => {
      asked.push(target.href);
      return target.pathname === "/open";
    };
    world.app.use("*", csrfMintStage(options, isUnbound));
    mapHandler(world.app, "GET", "/open", async (c) => new Response(await mintCsrf(c, c.url.searchParams.get("for") ?? "")));
    for (const path of ["/open", "/save"]) {
      mapHandler(world.app, "POST", path, () => {
        world.events.push("handler");
        return new Response(`posted ${path}`);
      });
    }
    return { ...world, asked };
  }

  it("asks the predicate about the token's target, resolved against the request URL, and mints it path-only", async () => {
    const world = unboundWorld();
    const token = await (await world.app.request("/open?for=/open", { headers: { "x-session": "session-a" } })).text();

    expect({
      asked: world.asked,
      events: world.events,
      pathOnly: await verifyCsrfToken(ring, token, "/open"),
      underSession: await verifyCsrfToken(ring, token, "/open", { subject: "session-a" }),
    }).toEqual({
      asked: ["http://localhost/open"],
      events: ["ring"],
      pathOnly: { ok: true },
      underSession: { ok: false, error: "subject-mismatch" },
    });
  });

  it("binds a token for a bound target to the subject, though it is minted on an unbound path", async () => {
    const world = unboundWorld();
    const token = await (await world.app.request("/open?for=/save", { headers: { "x-session": "session-a" } })).text();

    expect({
      asked: world.asked,
      events: world.events,
      sameSession: await verifyCsrfToken(ring, token, "/save", { subject: "session-a" }),
      otherSession: await verifyCsrfToken(ring, token, "/save", { subject: "session-b" }),
    }).toEqual({
      asked: ["http://localhost/save"],
      events: ["ring", "subject"],
      sameSession: { ok: true },
      otherSession: { ok: false, error: "subject-mismatch" },
    });
  });

  it("passes a path-only token on an unbound path with no subject, never consulting the resolver", async () => {
    const world = unboundWorld();
    const token = await createCsrfToken(ring, "/open");

    const res = await world.app.request("/open", world.post({ "x-csrf-token": token }));

    expect({ status: res.status, body: await res.text(), events: world.events, asked: world.asked }).toEqual({
      status: 200,
      body: "posted /open",
      events: ["ring", "handler"],
      asked: ["http://localhost/open"],
    });
  });

  it("still refuses a subject-less mutation on a bound path as unbound-subject", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const world = unboundWorld();
      const token = await createCsrfToken(ring, "/save");

      const res = await world.app.request("/save", world.post({ "x-csrf-token": token }));

      expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
        status: 403,
        body: "refused: unbound-subject",
        events: ["subject", "refused:unbound-subject"],
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("refuses a path-only token on a bound path under a subject as subject-mismatch", async () => {
    const world = unboundWorld();
    const token = await createCsrfToken(ring, "/save");

    const res = await world.app.request("/save", world.post({ "x-csrf-token": token, "x-session": "session-a" }));

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 403,
      body: "refused: subject-mismatch",
      events: ["subject", "ring", "refused:subject-mismatch"],
    });
  });

  it("binds every target when no predicate is given", async () => {
    const world = stagedWorld(() => ring);
    world.app.use("*", csrfMintStage({ ...world.options, subject: (c) => c.request.headers.get("x-session") ?? undefined }));
    mapHandler(world.app, "GET", "/open", async (c) => new Response(await mintCsrf(c, "/open")));

    const token = await (await world.app.request("/open", { headers: { "x-session": "session-a" } })).text();

    expect(await verifyCsrfToken(ring, token, "/open", { subject: "session-a" })).toEqual({ ok: true });
  });
});

describe("csrfVerifyStage", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  function stagedApp(world: ReturnType<typeof stagedWorld>, ...between: Middleware[]) {
    world.app.use("*", csrfMintStage(world.options), csrfVerifyStage(world.refuse), ...between, csrfVerifyStage(world.refuse));
    mapHandler(world.app, "POST", "/save", () => {
      world.events.push("handler");
      return new Response("saved");
    });
    return world.app;
  }

  it("refuses a tokenless mutation once, however many verify stages follow", async () => {
    const world = stagedWorld(() => ring);
    const res = await stagedApp(world).request("/save", world.post());

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 403,
      body: "refused: missing-token",
      events: ["body", "ring", "refused:missing-token"],
    });
  });

  it("checks a valid token once, so a later stage never re-reads the request", async () => {
    const world = stagedWorld(() => ring);
    const token = await createCsrfToken(ring, "/save");
    const res = await stagedApp(world, swapTokenHeader).request("/save", world.post({ "x-csrf-token": token }));

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({
      status: 200,
      body: "saved",
      events: ["ring", "handler"],
    });
  });

  it("passes a mutation through when no mint stage armed a check", async () => {
    const world = stagedWorld(() => ring);
    world.app.use("*", csrfVerifyStage(world.refuse));
    mapHandler(world.app, "POST", "/save", () => new Response("saved"));

    const res = await world.app.request("/save", world.post());

    expect({ status: res.status, body: await res.text(), events: world.events }).toEqual({ status: 200, body: "saved", events: [] });
  });
});

describe("CSRF token lifetime", () => {
  const HOUR = 3_600_000;
  const MINTED_AT = 1_790_000_000_000;
  let ring: KeyRing;

  beforeAll(async () => {
    ring = await importKeyRing([HEX_KEY_A]);
  });

  afterEach(() => {
    setSystemTime();
  });

  async function tokenAged(ageMs: number): Promise<string> {
    setSystemTime(new Date(MINTED_AT));
    const token = await createCsrfToken(ring, "/api/contact");
    setSystemTime(new Date(MINTED_AT + ageMs));
    return token;
  }

  function policyApp(policy: Partial<CsrfPolicyOptions> = {}) {
    const refusals: Refusal[] = [];
    const app = new Forge();
    publishRefuseHook(app, (_c, refusal) => {
      refusals.push(refusal);
      return new Response(`refused: ${"reason" in refusal ? refusal.reason : refusal.guard}`, { status: refusal.status });
    });
    app.use("*", csrfMintStage({ ring: () => ring, subject: false, ...policy }));
    mapHandler(app, "POST", "/api/contact", () => new Response("ok"));
    return { app, refusals };
  }

  const EXPIRED = { ok: false, error: "expired" };

  const verifyCases: Array<{ name: string; ageMs: number; options?: { maxAgeMs: number }; expected: unknown }> = [
    { name: "verifies a token aged 20 hours at the default", ageMs: 20 * HOUR, expected: { ok: true } },
    { name: "verifies a token aged exactly 24 hours at the default", ageMs: 24 * HOUR, expected: { ok: true } },
    { name: "refuses a token aged 24 hours and 1 ms as expired at the default", ageMs: 24 * HOUR + 1, expected: EXPIRED },
    { name: "refuses a token aged 2 hours as expired under a maxAgeMs of 1 hour", ageMs: 2 * HOUR, options: { maxAgeMs: HOUR }, expected: EXPIRED },
    {
      name: "verifies a token aged 30 hours under a maxAgeMs of 48 hours",
      ageMs: 30 * HOUR,
      options: { maxAgeMs: 48 * HOUR },
      expected: { ok: true },
    },
  ];

  for (const { name, ageMs, options, expected } of verifyCases) {
    it(`verifyCsrfToken ${name}`, async () => {
      const token = await tokenAged(ageMs);
      expect(await verifyCsrfToken(ring, token, "/api/contact", options)).toEqual(expected);
    });
  }

  const ADMITTED = { status: 200, body: "ok", refusals: [] };
  const REFUSED_EXPIRED = { status: 403, body: "refused: expired", refusals: [{ guard: "csrf", status: 403, reason: "expired" }] };

  const policyCases: Array<{ name: string; ageMs: number; policy?: { maxAgeMs: number }; expected: unknown }> = [
    { name: "admits a token aged 20 hours at the default", ageMs: 20 * HOUR, expected: ADMITTED },
    { name: "hands a token aged 24 hours and 1 ms to the hook as expired at the default", ageMs: 24 * HOUR + 1, expected: REFUSED_EXPIRED },
    {
      name: "hands a token aged 2 hours to the hook as expired under a maxAgeMs of 1 hour",
      ageMs: 2 * HOUR,
      policy: { maxAgeMs: HOUR },
      expected: REFUSED_EXPIRED,
    },
    { name: "admits a token aged 30 hours under a maxAgeMs of 48 hours", ageMs: 30 * HOUR, policy: { maxAgeMs: 48 * HOUR }, expected: ADMITTED },
    { name: "admits a token aged 1 ms under the 1 ms floor", ageMs: 1, policy: { maxAgeMs: 1 }, expected: ADMITTED },
    { name: "hands a token aged 2 ms to the hook as expired under the 1 ms floor", ageMs: 2, policy: { maxAgeMs: 1 }, expected: REFUSED_EXPIRED },
  ];

  for (const { name, ageMs, policy, expected } of policyCases) {
    it(`csrfMintStage ${name}`, async () => {
      const { app, refusals } = policyApp(policy);
      const token = await tokenAged(ageMs);
      const res = await app.request("/api/contact", { method: "POST", headers: { "X-CSRF-Token": token } });
      expect({ status: res.status, body: await res.text(), refusals }).toEqual(expected);
    });
  }

  const FLOOR = "below the 1-millisecond floor — a token that never verifies refuses every mutation.";
  const knobRefusals: Array<{ maxAgeMs: number; message: string }> = [
    { maxAgeMs: 0, message: `csrfMintStage: maxAgeMs is 0, ${FLOOR}` },
    { maxAgeMs: -1, message: `csrfMintStage: maxAgeMs is -1, ${FLOOR}` },
    { maxAgeMs: 1.5, message: "csrfMintStage: maxAgeMs is 1.5, which is not a whole number." },
    { maxAgeMs: Number.NaN, message: "csrfMintStage: maxAgeMs is NaN, which is not a whole number." },
    { maxAgeMs: Number.POSITIVE_INFINITY, message: "csrfMintStage: maxAgeMs is Infinity, which is not a whole number." },
  ];

  for (const { maxAgeMs, message } of knobRefusals) {
    it(`csrfMintStage throws at construction on a maxAgeMs of ${maxAgeMs}`, () => {
      expect(() => csrfMintStage({ ring: () => ring, subject: false, maxAgeMs })).toThrow(new Error(message));
    });
  }
});

describe("applyMiddlewareChain's csrf policy — a ring over the app's Bindings", () => {
  interface Env {
    readonly CSRF_SECRET: string;
  }

  it("refuses a binding Env does not declare at bun check, and takes one it does", () => {
    const missing = () =>
      applyMiddlewareChain<Env>(new Forge<Env>(), {
        securityHeaders: {},
        csrf: {
          // @ts-expect-error — `CSRF_SECRETS` is not a binding of Env
          ring: (env) => importKeyRing([env.CSRF_SECRETS]),
          subject: false,
        },
      });
    const declared = () =>
      applyMiddlewareChain<Env>(new Forge<Env>(), {
        securityHeaders: {},
        csrf: { ring: (env) => importKeyRing([env.CSRF_SECRET]), subject: false },
      });
    void [missing, declared];
  });

  it("infers Bindings from the app with no explicit generic, reporting an undeclared binding on the ring and not on the app", () => {
    const app = new Forge<Env>();
    const missing = () =>
      applyMiddlewareChain(app, {
        securityHeaders: {},
        csrf: {
          // @ts-expect-error — `CSRF_SECRETS` is not a binding of the app's Env
          ring: (env) => importKeyRing([env.CSRF_SECRETS]),
          subject: false,
        },
      });
    const declared = () =>
      applyMiddlewareChain(app, { securityHeaders: {}, csrf: { ring: (env) => importKeyRing([env.CSRF_SECRET]), subject: false } });
    void [missing, declared];
  });
});

describe("csrfMintStage — a ring over the app's Bindings", () => {
  interface Env {
    readonly CSRF_SECRET: string;
  }

  it("refuses a binding Env does not declare at bun check, and takes one it does", () => {
    const missing = () =>
      csrfMintStage<Env>({
        // @ts-expect-error — `CSRF_SECRETS` is not a binding of Env
        ring: (env) => importKeyRing([env.CSRF_SECRETS]),
        subject: false,
      });
    const declared = () => csrfMintStage<Env>({ ring: (env) => importKeyRing([env.CSRF_SECRET]), subject: false });
    void [missing, declared];
  });
});

describe("csrfMintStage — a ring cast past its type to read the request context", () => {
  const HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";
  // oxlint-disable-next-line typescript/no-explicit-any -- a 0.7.7 resolver typed against the context it is no longer handed
  type ContextResolver = (c: any) => Promise<KeyRing>;
  const unconverted: { name: string; ring: ContextResolver }[] = [
    { name: "c.env", ring: (c) => importKeyRing([c.env.CSRF_SECRET]) },
    { name: "c.get", ring: (c) => importKeyRing([c.get("CSRF_SECRET")]) },
  ];

  for (const { name, ring } of unconverted) {
    it(`answers the first request that mints with the rewrite, for a ring reading ${name}`, async () => {
      const app = new Forge<{ CSRF_SECRET: string }>();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      app.use("*", csrfMintStage({ ring: ring as KeyRingResolver, subject: false }));
      mapHandler(app, "GET", "/page", async (c) => new Response(await mintCsrf(c, "/save")));
      const res = await app.request("/page", {}, { CSRF_SECRET: HEX_SECRET });
      expect({ status: res.status, body: await res.text() }).toEqual({ status: 500, body: HANDED_ENV });
    });
  }
});

describe("csrfMintStage — a ring wrapped in createKeyRingResolver", () => {
  interface AppEnv {
    readonly CSRF_SECRET: string;
  }
  const UNWRAP = "csrfMintStage: pass the `(env) => importKeyRing(…)` function itself, not `createKeyRingResolver(…)`";

  it("is refused at bun check whatever Bindings it was made under, and throws at construction", () => {
    const inferred = () =>
      csrfMintStage({
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        ring: createKeyRingResolver(() => importKeyRing([HEX_SECRET])),
        subject: false,
      });
    const typed = () =>
      csrfMintStage({
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        ring: createKeyRingResolver<AppEnv>((env) => importKeyRing([env.CSRF_SECRET])),
        subject: false,
      });
    expect(inferred).toThrow(new Error(UNWRAP));
    expect(typed).toThrow(new Error(UNWRAP));
  });

  it("cast past the type, throws at construction naming csrfMintStage and the fix", () => {
    const options: CsrfPolicyOptions = {
      ring: createKeyRingResolver<AppEnv>((env) => importKeyRing([env.CSRF_SECRET])) as unknown as KeyRingResolver,
      subject: false,
    };
    expect(() => csrfMintStage(options)).toThrow(new Error(UNWRAP));
  });
});

describe("csrfMintStage — the CORS preflight exemption", () => {
  let ring: KeyRing;
  beforeAll(async () => {
    ring = await importKeyRing([HEX_SECRET]);
  });

  const PREFLIGHT = { Origin: "https://partner.example.com", "Access-Control-Request-Method": "POST" };

  async function runStages(method: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
    const context = createTestContext(new Request("http://localhost/any", { method: "OPTIONS", headers }));
    context.method = method;
    const verify = csrfVerifyStage((_c, refusal) => Response.json(refusal, { status: refusal.status }));
    const res = await csrfMintStage({ ring: () => ring, subject: false })(context, async () =>
      verify(context, () => Promise.resolve(new Response("reached"))),
    );
    return { status: res.status, body: res.headers.get("content-type")?.startsWith("application/json") ? await res.json() : await res.text() };
  }

  it("exempts a preflight whose method arrives in any letter case", async () => {
    const cases = ["options", "Options", "oPTIONS"];
    for (const method of cases) {
      expect({ method, ...(await runStages(method, PREFLIGHT)) }).toEqual({ method, status: 200, body: "reached" });
    }
  });

  it("arms a lower-case options that carries Origin alone", async () => {
    expect(await runStages("options", { Origin: "https://partner.example.com" })).toEqual({
      status: 403,
      body: { guard: "csrf", status: 403, reason: "missing-token" },
    });
  });

  it("arms a non-OPTIONS method carrying both preflight headers", async () => {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "ANY", "/any", () => new Response("ok"));

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await app.request("/any", { method, headers: PREFLIGHT });
      expect({ method, status: res.status, body: await res.text() }).toEqual({ method, status: 403, body: "Forbidden" });
    }
  });

  it("refuses a tokenless OPTIONS carrying a form body and Origin alone", async () => {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "ANY", "/any", () => new Response("ok"));

    const res = await app.request("/any", {
      method: "OPTIONS",
      headers: { Origin: "https://partner.example.com", "content-type": "application/x-www-form-urlencoded" },
      body: "name=Jane",
    });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 403, body: "Forbidden" });
  });

  it("passes an OPTIONS carrying a form body whose _csrf field holds a valid token", async () => {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "ANY", "/any", () => new Response("ok"));
    const token = await createCsrfToken(ring, "/any");

    const res = await app.request("/any", {
      method: "OPTIONS",
      headers: { Origin: "https://partner.example.com", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: token }).toString(),
    });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 200, body: "ok" });
  });

  it("still publishes the minter on a preflight it leaves unarmed", async () => {
    const app = new Forge();
    app.use("*", csrfMintStage({ ring: () => ring, subject: false }));
    mapHandler(app, "ANY", "/any", async (c) => new Response(String(csrfMinterCtx.getOptional(c) !== undefined)));

    const res = await app.request("/any", { method: "OPTIONS", headers: PREFLIGHT });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 200, body: "true" });
  });
});
