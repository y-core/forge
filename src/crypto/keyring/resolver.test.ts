import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import { EnvKey } from "../../context/types";
import type { AppContext } from "../../context/types";
import { createKeyRingResolver } from "./resolver";
import { importKeyRing, KEY_RING_DOMAIN } from "./ring";
import { resolveKeyRingKey } from "./subkey";
import type { KeyRing } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";

interface Env {
  readonly SECRET: string;
}

function contextUnder(env?: object): RequestContext {
  const context = new RequestContext(new Request("http://localhost/"));
  if (env !== undefined) context.set(EnvKey, env, { property: "env" });
  return context;
}

function countingResolver(): { resolve: (c: AppContext<Env>) => Promise<KeyRing>; calls: () => number } {
  let calls = 0;
  return {
    resolve: (c) => {
      calls++;
      return importKeyRing([c.env.SECRET]);
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
    const resolveRing = createKeyRingResolver<Env>((c) => {
      calls++;
      if (calls === 1) throw new Error("secret unavailable");
      return importKeyRing([c.env.SECRET]);
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
    const resolveRing = createKeyRingResolver<Env>((c) => importKeyRing([c.env.SECRET]));
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
