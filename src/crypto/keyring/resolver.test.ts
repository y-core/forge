import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import { Forge } from "../../app/forge-app";
import { EnvKey } from "../../context/types";
import { mapHandler } from "../../testing/route";
import { createKeyRingResolver } from "./resolver";
import { importKeyRing, KEY_RING_DOMAIN } from "./ring";
import { parseKeyRingSecrets } from "./secrets";
import { resolveKeyRingKey } from "./subkey";
import type { KeyRing, KeyRingResolver } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";

interface Env {
  readonly SECRET: string;
}

function contextUnder(env?: object): RequestContext {
  const context = new RequestContext(new Request("http://localhost/"));
  if (env !== undefined) context.set(EnvKey, env, { property: "env" });
  return context;
}

function countingResolver(): { resolve: (env: Env) => Promise<KeyRing>; calls: () => number } {
  let calls = 0;
  return {
    resolve: (env) => {
      calls++;
      return importKeyRing([env.SECRET]);
    },
    calls: () => calls,
  };
}

describe("createKeyRingResolver()", () => {
  it("resolves the ring once per env and answers the same ring after", async () => {
    const counter = countingResolver();
    const resolveRing = createKeyRingResolver(counter.resolve);
    const env = { SECRET: SECRET_A };
    const first = await resolveRing(contextUnder(env));
    const second = await resolveRing(contextUnder(env));
    expect({ same: first === second, calls: counter.calls() }).toEqual({ same: true, calls: 1 });
  });

  it("resolves a ring of its own for each env object", async () => {
    const counter = countingResolver();
    const resolveRing = createKeyRingResolver(counter.resolve);
    const first = await resolveRing(contextUnder({ SECRET: SECRET_A }));
    const second = await resolveRing(contextUnder({ SECRET: SECRET_A }));
    expect({ same: first === second, calls: counter.calls() }).toEqual({ same: false, calls: 2 });
  });

  it("rethrows a rejection and retries on the next call rather than caching it", async () => {
    let calls = 0;
    const resolveRing = createKeyRingResolver<Env>((env) => {
      calls++;
      if (calls === 1) throw new Error("secret unavailable");
      return importKeyRing([env.SECRET]);
    });
    const env = { SECRET: SECRET_A };
    await expect(resolveRing(contextUnder(env))).rejects.toThrow("secret unavailable");
    const ring = await resolveRing(contextUnder(env));
    expect({ activeKeyId: typeof ring.activeKeyId, calls }).toEqual({ activeKeyId: "string", calls: 2 });
  });

  it("resolves once for two concurrent first calls under one env", async () => {
    const counter = countingResolver();
    const resolveRing = createKeyRingResolver(counter.resolve);
    const env = { SECRET: SECRET_A };
    const [first, second] = await Promise.all([resolveRing(contextUnder(env)), resolveRing(contextUnder(env))]);
    expect({ same: first === second, calls: counter.calls() }).toEqual({ same: true, calls: 1 });
  });

  it("resolves on every call where the context carries no env", async () => {
    const ring = await importKeyRing([SECRET_A]);
    let calls = 0;
    const resolveRing = createKeyRingResolver(() => {
      calls++;
      return ring;
    });
    await resolveRing(contextUnder());
    await resolveRing(contextUnder());
    expect(calls).toBe(2);
  });

  it("accepts a resolver that answers synchronously", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const resolveRing = createKeyRingResolver(() => ring);
    expect(await resolveRing(contextUnder({}))).toBe(ring);
  });

  it("imports no key on a second call under one env, since the ring's subkey cache survives", async () => {
    const resolveRing = createKeyRingResolver<Env>((env) => importKeyRing([env.SECRET]));
    const env = { SECRET: SECRET_A };
    const first = await resolveRing(contextUnder(env));
    const request = { domain: KEY_RING_DOMAIN, kid: first.activeKeyId, purpose: "p" };
    await resolveKeyRingKey(first, request, "hmac");

    // oxlint-disable-next-line typescript/no-explicit-any -- swapping the platform method for a counter
    const original = (crypto.subtle as any).importKey;
    let imports = 0;
    // oxlint-disable-next-line typescript/no-explicit-any -- swapping the platform method for a counter
    (crypto.subtle as any).importKey = (...args: unknown[]) => {
      imports++;
      return original.apply(crypto.subtle, args);
    };
    try {
      await resolveKeyRingKey(await resolveRing(contextUnder(env)), request, "hmac");
      expect(imports).toBe(0);
    } finally {
      // oxlint-disable-next-line typescript/no-explicit-any -- restoring the platform method
      (crypto.subtle as any).importKey = original;
    }
  });
});

describe("createKeyRingResolver() — the README's in-handler use", () => {
  interface AppEnv {
    readonly APP_SEAL_KEY_RING: string;
  }

  it("type-checks against a handler's context and answers the env's ring", async () => {
    const appRing = createKeyRingResolver<AppEnv>((env) => importKeyRing(parseKeyRingSecrets(env.APP_SEAL_KEY_RING)));
    const app = new Forge<AppEnv>();
    mapHandler(app, "GET", "/", async (c) => {
      const ring = await appRing(c);
      return new Response(ring.activeKeyId);
    });
    const res = await app.request("/", {}, { APP_SEAL_KEY_RING: SECRET_A });
    expect(await res.text()).toBe((await importKeyRing([SECRET_A])).activeKeyId);
  });
});

describe("KeyRingResolver — what a ring option takes", () => {
  it("takes a ring answered synchronously or as a promise, and refuses one answering anything else at bun check", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const sync: KeyRingResolver<Env> = () => ring;
    const promised: KeyRingResolver<Env> = async () => ring;
    // @ts-expect-error — a promise of the secret is not a promise of a key ring
    const secretOnly: KeyRingResolver<Env> = async (env) => env.SECRET;
    void secretOnly;
    const env = { SECRET: SECRET_A };
    expect([await createKeyRingResolver(sync)(contextUnder(env)), await createKeyRingResolver(promised)(contextUnder(env))]).toEqual([ring, ring]);
  });

  it("refuses a binding Env does not declare at bun check, and takes one it does", () => {
    // @ts-expect-error — `SECRETS` is not a binding of Env
    const missing = () => createKeyRingResolver<Env>((env) => importKeyRing([env.SECRETS]));
    const declared = () => createKeyRingResolver<Env>((env) => importKeyRing([env.SECRET]));
    void [missing, declared];
  });

  it("reads any binding as unknown under the default bindings, so importKeyRing refuses it unnarrowed at bun check", async () => {
    // @ts-expect-error — `env.SECRET` is `unknown` under the default bindings, and importKeyRing takes strings
    const unnarrowed: KeyRingResolver = (env) => importKeyRing([env.SECRET]);
    const narrowed: KeyRingResolver = (env) => importKeyRing([String(env.SECRET)]);
    void unnarrowed;
    const resolved = await createKeyRingResolver(narrowed)(contextUnder({ SECRET: SECRET_A }));
    expect(resolved.activeKeyId).toBe((await importKeyRing([SECRET_A])).activeKeyId);
  });
});

describe("createKeyRingResolver() — a resolver cast past its type to read the request context", () => {
  const HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";
  // oxlint-disable-next-line typescript/no-explicit-any -- a 0.7.7 resolver typed against the context it is no longer handed
  type ContextResolver = (c: any) => Promise<KeyRing>;
  const unconverted: { name: string; resolve: ContextResolver }[] = [
    { name: "c.env", resolve: (c) => importKeyRing([c.env.SECRET]) },
    { name: "c.get", resolve: (c) => importKeyRing([c.get("SECRET")]) },
  ];

  for (const { name, resolve } of unconverted) {
    it(`rejects the first resolve with the rewrite, for a resolver reading ${name}`, async () => {
      const resolveRing = createKeyRingResolver(resolve as KeyRingResolver<Env>);
      await expect(resolveRing(contextUnder({ SECRET: SECRET_A }))).rejects.toThrow(new Error(HANDED_ENV));
    });
  }
});
