import { beforeAll, describe, expect, it, setSystemTime } from "bun:test";

import { Forge } from "../../app/forge-app";
import { createKeyRingResolver } from "../../crypto/keyring/resolver";
import { importKeyRing } from "../../crypto/keyring/ring";
import type { KeyRing, KeyRingResolver } from "../../crypto/keyring/types";
import { requestLog } from "../../logging/request-logger";
import { nullLogger } from "../../testing/context";
import { mapHandler } from "../../testing/route";
import { signedObjectKey, signedObjectLink } from "./link";
import { createSignedObjectUrl } from "./signing";
import type { SignedObjectLinkOptions, SignedUrlFailure } from "./types";

const SECRET = "5e1d0c7a9b3f28e46a0d91c7b52f8e3a4c6d17b09e2f5a83c1d4e6b7f9a02c58";
const RETIRED_SECRET = "a3c9e1f70b2d48c6e5a7913f0d2b6c84e1f3a5079c2d4e6f8b0a1c3e5d7f9b21";
const BASE = "https://cdn.example.com/download";
const OBJECT_KEY = "avatars/42.png";

interface LinkApp {
  app: Forge;
  warnings: unknown[];
  reached: string[];
  errors: Error[];
}

function linkApp(options: SignedObjectLinkOptions, { withLogger = true } = {}): LinkApp {
  const warnings: unknown[] = [];
  const reached: string[] = [];
  const errors: Error[] = [];
  const app = new Forge(nullLogger);
  app.setOnError((error) => {
    errors.push(error);
    return new Response("boundary", { status: 500 });
  });
  if (withLogger) {
    app.use("*", (context, next) => {
      requestLog.set(context, { ...nullLogger, warn: (message: string, data?: Record<string, unknown>) => void warnings.push([message, data]) });
      return next();
    });
  }
  app.use("*", signedObjectLink(options));
  mapHandler(app, "GET", "/download", (c) => {
    const key = signedObjectKey.get(c);
    reached.push(key);
    return new Response(key);
  });
  return { app, warnings, reached, errors };
}

function pathOf(url: string | URL): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function withParam(url: string, name: string, value: string | null): string {
  const parsed = new URL(url);
  if (value === null) parsed.searchParams.delete(name);
  else parsed.searchParams.set(name, value);
  return pathOf(parsed);
}

describe("signedObjectLink", () => {
  let ring: KeyRing;
  let retiredRing: KeyRing;
  let rotatedRing: KeyRing;
  let signed: string;
  beforeAll(async () => {
    ring = await importKeyRing([SECRET]);
    retiredRing = await importKeyRing([RETIRED_SECRET]);
    rotatedRing = await importKeyRing([SECRET, RETIRED_SECRET]);
    signed = await createSignedObjectUrl(ring, BASE, OBJECT_KEY);
  });

  it("admits a valid link, runs the handler once, and exposes the verified key through signedObjectKey", async () => {
    const { app, warnings, reached } = linkApp({ ring: () => ring });
    const res = await app.request(pathOf(signed));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(OBJECT_KEY);
    expect(reached).toEqual([OBJECT_KEY]);
    expect(warnings).toEqual([]);
  });

  it("exposes a key containing reserved URL characters exactly as it was signed", async () => {
    const key = "reports/q3 2026/a&b=c?.pdf";
    const { app } = linkApp({ ring: () => ring });
    const res = await app.request(pathOf(await createSignedObjectUrl(ring, BASE, key)));
    expect(await res.text()).toBe(key);
  });

  it("admits a link signed by a retired key the ring still holds", async () => {
    const { app, reached } = linkApp({ ring: () => rotatedRing });
    const res = await app.request(pathOf(await createSignedObjectUrl(retiredRing, BASE, OBJECT_KEY)));
    expect(res.status).toBe(200);
    expect(reached).toEqual([OBJECT_KEY]);
  });

  it("accepts an async ring resolver", async () => {
    const { app } = linkApp({ ring: async () => ring });
    const res = await app.request(pathOf(signed));
    expect(await res.text()).toBe(OBJECT_KEY);
  });

  describe("refusal", () => {
    const cases: { name: string; path: () => Promise<string>; ring?: () => KeyRing; reason: SignedUrlFailure }[] = [
      { name: "a tampered object key", path: async () => withParam(signed, "key", "avatars/43.png"), reason: "invalid-signature" },
      {
        name: "a tampered expiry pushed later",
        path: async () => withParam(signed, "exp", String(Number(new URL(signed).searchParams.get("exp")) + 3600)),
        reason: "invalid-signature",
      },
      {
        name: "a forged signature",
        path: async () => withParam(signed, "sig", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
        reason: "invalid-signature",
      },
      // "!!!" is outside the base64url alphabet.
      { name: "a signature that is not base64url", path: async () => withParam(signed, "sig", "!!!"), reason: "invalid-signature" },
      { name: "a link signed by a key off the ring", path: async () => pathOf(signed), ring: () => retiredRing, reason: "unknown-key" },
      { name: "a rewritten key id", path: async () => withParam(signed, "kid", "zzzzzzzz"), reason: "unknown-key" },
      { name: "a link with no parameters", path: async () => "/download", reason: "invalid-format" },
      { name: "a link missing key", path: async () => withParam(signed, "key", null), reason: "invalid-format" },
      { name: "a link missing exp", path: async () => withParam(signed, "exp", null), reason: "invalid-format" },
      { name: "a link missing kid", path: async () => withParam(signed, "kid", null), reason: "invalid-format" },
      { name: "a link missing sig", path: async () => withParam(signed, "sig", null), reason: "invalid-format" },
      { name: "a link with an empty key", path: async () => withParam(signed, "key", ""), reason: "invalid-format" },
      { name: "a non-numeric expiry", path: async () => withParam(signed, "exp", "1e12"), reason: "invalid-format" },
      { name: "a negative expiry", path: async () => withParam(signed, "exp", "-1"), reason: "invalid-format" },
    ];

    for (const { name, path, ring: ringFor, reason } of cases) {
      it(`refuses ${name} with a bare 403, logs ${reason}, and never runs the handler`, async () => {
        const { app, warnings, reached } = linkApp({ ring: ringFor ?? (() => ring) });
        const res = await app.request(await path());
        expect(res.status).toBe(403);
        expect(await res.text()).toBe("Forbidden");
        expect(reached).toEqual([]);
        expect(warnings).toEqual([["storage.signed-link.refused", { reason }]]);
      });
    }

    it("refuses an expired link with a bare 403, logs expired, and never runs the handler", async () => {
      const { app, warnings, reached } = linkApp({ ring: () => ring });
      const url = await createSignedObjectUrl(ring, BASE, OBJECT_KEY, { expiresInSeconds: 1 });
      setSystemTime(new Date(Date.now() + 5_000));
      try {
        const res = await app.request(pathOf(url));
        expect(res.status).toBe(403);
        expect(await res.text()).toBe("Forbidden");
      } finally {
        setSystemTime();
      }
      expect(reached).toEqual([]);
      expect(warnings).toEqual([["storage.signed-link.refused", { reason: "expired" }]]);
    });

    it("still refuses with a bare 403 when no request logger is installed", async () => {
      const { app, reached } = linkApp({ ring: () => ring }, { withLogger: false });
      const res = await app.request(withParam(signed, "key", "avatars/43.png"));
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("Forbidden");
      expect(reached).toEqual([]);
    });
  });

  describe("onRefuse", () => {
    it("receives the request context and the reason, and its response is the one returned", async () => {
      const calls: [string, SignedUrlFailure][] = [];
      const { app, warnings, reached } = linkApp({
        ring: () => ring,
        onRefuse: (c, reason) => {
          calls.push([new URL(c.request.url).searchParams.get("key") ?? "", reason]);
          return new Response("gone", { status: 404, headers: { "x-refused": "1" } });
        },
      });
      const res = await app.request(withParam(signed, "key", "avatars/43.png"));
      expect(res.status).toBe(404);
      expect(res.headers.get("x-refused")).toBe("1");
      expect(await res.text()).toBe("gone");
      expect(calls).toEqual([["avatars/43.png", "invalid-signature"]]);
      expect(reached).toEqual([]);
      expect(warnings).toEqual([["storage.signed-link.refused", { reason: "invalid-signature" }]]);
    });

    it("awaits an async onRefuse", async () => {
      const { app } = linkApp({ ring: () => ring, onRefuse: async (_c, reason) => new Response(reason, { status: 410 }) });
      const res = await app.request("/download");
      expect(res.status).toBe(410);
      expect(await res.text()).toBe("invalid-format");
    });

    it("is not called for a valid link", async () => {
      const reasons: SignedUrlFailure[] = [];
      const { app } = linkApp({
        ring: () => ring,
        onRefuse: (_c, reason) => {
          reasons.push(reason);
          return new Response(null, { status: 404 });
        },
      });
      const res = await app.request(pathOf(signed));
      expect(res.status).toBe(200);
      expect(reasons).toEqual([]);
    });
  });

  describe("ring resolution", () => {
    const failures: { name: string; resolve: () => KeyRing | Promise<KeyRing> }[] = [
      {
        name: "throws",
        resolve: () => {
          throw new Error("ring unavailable");
        },
      },
      { name: "rejects", resolve: () => Promise.reject(new Error("ring unavailable")) },
    ];

    for (const { name, resolve } of failures) {
      it(`fails closed when the resolver ${name}: the error reaches the boundary and the handler never runs`, async () => {
        const { app, reached, errors, warnings } = linkApp({ ring: resolve });
        const res = await app.request(pathOf(signed));
        expect(res.status).toBe(500);
        expect(await res.text()).toBe("boundary");
        expect(reached).toEqual([]);
        expect(errors.map((error) => error.message)).toEqual(["ring unavailable"]);
        expect(warnings).toEqual([]);
      });
    }

    it("resolves the ring once per env object", async () => {
      let calls = 0;
      const { app } = linkApp({
        ring: () => {
          calls++;
          return ring;
        },
      });
      const env = {};
      await app.request(pathOf(signed), {}, env);
      await app.request(pathOf(signed), {}, env);
      expect(calls).toBe(1);
      await app.request(pathOf(signed), {}, {});
      expect(calls).toBe(2);
    });

    it("retries resolution on the same env after a failure", async () => {
      let calls = 0;
      const { app, reached } = linkApp({
        ring: () => {
          calls++;
          if (calls === 1) throw new Error("ring unavailable");
          return ring;
        },
      });
      const env = {};
      expect((await app.request(pathOf(signed), {}, env)).status).toBe(500);
      const res = await app.request(pathOf(signed), {}, env);
      expect(res.status).toBe(200);
      expect(reached).toEqual([OBJECT_KEY]);
    });
  });

  describe("a ring wrapped in createKeyRingResolver", () => {
    interface AppEnv {
      readonly OBJECT_SECRET: string;
    }
    const UNWRAP = "signedObjectLink: pass the `(env) => importKeyRing(…)` function itself, not `createKeyRingResolver(…)`";

    it("is refused at bun check whatever Bindings it was made under, and throws at construction", () => {
      const inferred = () =>
        signedObjectLink({
          // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
          ring: createKeyRingResolver(() => ring),
        });
      const typed = () =>
        signedObjectLink<AppEnv>({
          // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
          ring: createKeyRingResolver<AppEnv>((env) => importKeyRing([env.OBJECT_SECRET])),
        });
      expect(inferred).toThrow(new Error(UNWRAP));
      expect(typed).toThrow(new Error(UNWRAP));
    });

    it("cast past the type, throws at construction naming signedObjectLink and the fix", () => {
      const wrapped = createKeyRingResolver<AppEnv>(() => ring) as unknown as KeyRingResolver<AppEnv>;
      expect(() => signedObjectLink<AppEnv>({ ring: wrapped })).toThrow(new Error(UNWRAP));
    });

    it("leaves a plain env resolver accepted, admitting a link signed under the env's secret", async () => {
      const app = new Forge<AppEnv>(nullLogger);
      app.use("*", signedObjectLink<AppEnv>({ ring: (env) => importKeyRing([env.OBJECT_SECRET]) }));
      mapHandler(app, "GET", "/download", (c) => new Response(signedObjectKey.get(c)));
      const res = await app.request(pathOf(signed), {}, { OBJECT_SECRET: SECRET });
      expect({ status: res.status, body: await res.text() }).toEqual({ status: 200, body: OBJECT_KEY });
    });
  });

  describe("a ring over the app's Bindings", () => {
    interface AppEnv {
      readonly OBJECT_SECRET: string;
    }

    it("refuses a binding AppEnv does not declare at bun check, and takes one it does", () => {
      const missing = () =>
        signedObjectLink<AppEnv>({
          // @ts-expect-error — `OBJECT_SECRETS` is not a binding of AppEnv
          ring: (env) => importKeyRing([env.OBJECT_SECRETS]),
        });
      const declared = () => signedObjectLink<AppEnv>({ ring: (env) => importKeyRing([env.OBJECT_SECRET]) });
      void [missing, declared];
    });
  });

  describe("a ring cast past its type to read the request context", () => {
    const HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";
    // oxlint-disable-next-line typescript/no-explicit-any -- a 0.7.7 resolver typed against the context it is no longer handed
    type ContextResolver = (c: any) => Promise<KeyRing>;
    const unconverted: { name: string; resolve: ContextResolver }[] = [
      { name: "c.env", resolve: (c) => importKeyRing([c.env.OBJECT_SECRET]) },
      { name: "c.get", resolve: (c) => importKeyRing([c.get("OBJECT_SECRET")]) },
    ];

    for (const { name, resolve } of unconverted) {
      it(`fails closed with the rewrite at the boundary, for a ring reading ${name}`, async () => {
        const { app, reached, errors } = linkApp({ ring: resolve as KeyRingResolver });
        const res = await app.request(pathOf(signed), {}, { OBJECT_SECRET: SECRET });
        expect({ status: res.status, reached, errors: errors.map((error) => error.message) }).toEqual({
          status: 500,
          reached: [],
          errors: [HANDED_ENV],
        });
      });
    }
  });
});
