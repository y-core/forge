import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createConfig } from "../../config/config";
import { derivePseudonym } from "../../crypto/keyring/pseudonym";
import { createKeyRingResolver } from "../../crypto/keyring/resolver";
import { importKeyRing, lookupKeyRingKey } from "../../crypto/keyring/ring";
import { openAtRest, sealAtRest } from "../../crypto/keyring/seal";
import type { KeyRing, KeyRingResolver } from "../../crypto/keyring/types";
import { hexToBytes } from "../../crypto/primitives/bytes";
import { createTestContext } from "../../testing/context";
import { buildRequest } from "../../testing/request";
import { v } from "../../validation/validation";
import { importAuthKeyRing, resolveAuthServices } from "./ring";
import type { AuthOptions } from "./types";

const KEY_1 = hexToBytes("0f328854bb8d3fe151893c6bb80e0298d42b867e556a95190618a51b75d8b8e9");
const KEY_2 = hexToBytes("8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d");

function ring(overrides: Partial<KeyRing> = {}): KeyRing {
  return { activeKeyId: "k1", keys: { k1: KEY_1 }, ...overrides };
}

// oxlint-disable-next-line typescript/no-explicit-any -- the test only needs `env` off the context
function contextFor(env: object): any {
  return createTestContext(buildRequest("https://app.example/auth/signin"), { env });
}

describe("importAuthKeyRing — the entropy floor", () => {
  it("names importAuthKeyRing when it refuses a degenerate secret", async () => {
    await expect(importAuthKeyRing(["00".repeat(32)])).rejects.toThrow(
      "importAuthKeyRing: a secret whose bytes are all the same value is not a secret",
    );
  });
});

describe("importAuthKeyRing — kept apart from at-rest sealing", () => {
  const SECRET = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";
  const binding = { purpose: "webhook-secret", context: new TextEncoder().encode("webhooks 1") as Uint8Array<ArrayBuffer> };
  const plaintext = new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>;

  it("is refused by the public sealAtRest, while a ring from importKeyRing over the same secret seals and opens", async () => {
    const authRing = await importAuthKeyRing([SECRET]);
    await expect(sealAtRest(authRing, binding, plaintext)).rejects.toThrow("never the auth key ring");

    const appRing = await importKeyRing([SECRET]);
    const frame = await sealAtRest(appRing, binding, plaintext);
    expect(await openAtRest(appRing, binding, frame)).toEqual({ ok: true, data: { plaintext, kid: appRing.activeKeyId } });
  });

  it("is refused by derivePseudonym, while a ring from importKeyRing over the same secret derives one", async () => {
    const request = { purpose: "notes-store", value: "user_01J9Z3" };
    const authRing = await importAuthKeyRing([SECRET]);
    await expect(derivePseudonym(authRing, request)).rejects.toThrow(
      `derivePseudonym: active key id "${authRing.activeKeyId}" is not one importKeyRing derives — use only a ring importKeyRing built, never the auth key ring`,
    );

    expect(await derivePseudonym(await importKeyRing([SECRET]), request)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolveAuthServices", () => {
  it("answers two option sets on one env with their own services, rather than the first caller's", async () => {
    const context = contextFor({ DB: {} });
    const first = { ring: () => ring() };
    const second = { ring: () => ring({ activeKeyId: "k2", keys: { k2: KEY_2 } }) };

    expect((await resolveAuthServices(context, first)).keys.activeKeyId).toBe("k1");
    expect((await resolveAuthServices(context, second)).keys.activeKeyId).toBe("k2");
    expect((await resolveAuthServices(context, first)).keys.activeKeyId).toBe("k1");
  });

  it("builds one option set once per env, so the cache is still a cache", async () => {
    const context = contextFor({ DB: {} });
    let calls = 0;
    const options = {
      ring: () => {
        calls++;
        return ring();
      },
    };
    await resolveAuthServices(context, options);
    await resolveAuthServices(context, options);
    expect(calls).toBe(1);
  });

  it("defaults to the two algorithms every supported runtime can verify", async () => {
    const services = await resolveAuthServices(contextFor({}), { ring: () => ring() });
    expect(services.algorithms).toEqual([-7, -257]);
  });

  it("returns the resolved key ring", async () => {
    const services = await resolveAuthServices(contextFor({}), { ring: () => ring() });
    expect(services.keys.activeKeyId).toBe("k1");
    expect(lookupKeyRingKey(services.keys, "k1")?.byteLength).toBe(32);
  });

  it("awaits an async ring resolver", async () => {
    const services = await resolveAuthServices(contextFor({}), { ring: async () => ring() });
    expect(services.keys.activeKeyId).toBe("k1");
  });

  it("resolves the ring once per env object and reuses it after", async () => {
    const env = {};
    let calls = 0;
    const options = {
      ring: () => {
        calls++;
        return ring();
      },
    };
    await resolveAuthServices(contextFor(env), options);
    await resolveAuthServices(contextFor(env), options);
    expect(calls).toBe(1);
  });

  it("resolves again for a different env object", async () => {
    let calls = 0;
    const options = {
      ring: () => {
        calls++;
        return ring();
      },
    };
    await resolveAuthServices(contextFor({}), options);
    await resolveAuthServices(contextFor({}), options);
    expect(calls).toBe(2);
  });

  it("resolves the ring once for two concurrent cold calls on one env", async () => {
    const env = {};
    let calls = 0;
    const options = {
      ring: async () => {
        calls++;
        return ring();
      },
    };
    const [first, second] = await Promise.all([resolveAuthServices(contextFor(env), options), resolveAuthServices(contextFor(env), options)]);
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it("keeps both option sets cached when they are first resolved concurrently on one env", async () => {
    const env = {};
    const calls = { first: 0, second: 0 };
    const first = {
      ring: async () => {
        calls.first++;
        return ring();
      },
    };
    const second = {
      ring: async () => {
        calls.second++;
        return ring({ activeKeyId: "k2", keys: { k2: KEY_2 } });
      },
    };
    await Promise.all([resolveAuthServices(contextFor(env), first), resolveAuthServices(contextFor(env), second)]);
    await resolveAuthServices(contextFor(env), first);
    await resolveAuthServices(contextFor(env), second);
    expect(calls).toEqual({ first: 1, second: 1 });
  });

  it("retries a ring resolver that rejected, rather than caching its failure for the env", async () => {
    const env = {};
    let calls = 0;
    const options = {
      ring: async () => {
        calls++;
        if (calls === 1) throw new Error("secret store unreachable");
        return ring();
      },
    };
    await expect(resolveAuthServices(contextFor(env), options)).rejects.toThrow("secret store unreachable");
    expect((await resolveAuthServices(contextFor(env), options)).keys.activeKeyId).toBe("k1");
    expect(calls).toBe(2);
  });

  it("throws when the ring has no key for its active id", () => {
    const resolve = (): KeyRing => ring({ activeKeyId: "k2" });
    expect(resolveAuthServices(contextFor({}), { ring: resolve })).rejects.toThrow(
      'resolveAuthServices: the key ring has no key for its active key id "k2"',
    );
  });

  it("throws when the active key id names an inherited property", () => {
    const resolve = (): KeyRing => ring({ activeKeyId: "constructor" });
    expect(resolveAuthServices(contextFor({}), { ring: resolve })).rejects.toThrow(
      'resolveAuthServices: the key ring has no key for its active key id "constructor"',
    );
  });

  it("throws when any key is shorter than 32 bytes", () => {
    const resolve = (): KeyRing => ({ activeKeyId: "k1", keys: { k1: KEY_1, k0: KEY_2.slice(0, 16) } });
    expect(resolveAuthServices(contextFor({}), { ring: resolve })).rejects.toThrow(
      'resolveAuthServices: key "k0": each secret must be at least 32 bytes (got 16)',
    );
  });

  it("throws when a hand-built ring carries a degenerate key that importAuthKeyRing would refuse", () => {
    const resolve = (): KeyRing => ({ activeKeyId: "k1", keys: { k1: KEY_1, k0: new Uint8Array(32).fill(7) } });
    expect(resolveAuthServices(contextFor({}), { ring: resolve })).rejects.toThrow(
      'resolveAuthServices: key "k0": a secret whose bytes are all the same value is not a secret',
    );
  });
});

describe("resolveAuthServices — the Ed25519 capability probe", () => {
  it("accepts -8 on a runtime that can import an Ed25519 key", async () => {
    const services = await resolveAuthServices(contextFor({}), { ring: () => ring(), algorithms: [-8, -7, -257] });
    expect(services.algorithms).toEqual([-8, -7, -257]);
  });
});

describe("resolveAuthServices — with Ed25519 import unavailable", () => {
  const original = crypto.subtle.importKey.bind(crypto.subtle);

  beforeAll(() => {
    // oxlint-disable-next-line typescript/no-explicit-any -- replacing a platform method for one describe block
    (crypto.subtle as any).importKey = (format: string, keyData: unknown, algorithm: unknown, ...rest: unknown[]) => {
      const name = typeof algorithm === "string" ? algorithm : (algorithm as { name?: string })?.name;
      if (name === "Ed25519") return Promise.reject(new Error("Unrecognized name."));
      // oxlint-disable-next-line typescript/no-explicit-any -- pass-through to the real implementation
      return (original as any)(format, keyData, algorithm, ...rest);
    };
  });

  afterAll(() => {
    // oxlint-disable-next-line typescript/no-explicit-any -- restoring the platform method
    (crypto.subtle as any).importKey = original;
  });

  it("throws when -8 is configured, naming the compatibility date and the opt-out", () => {
    expect(resolveAuthServices(contextFor({}), { ring: () => ring(), algorithms: [-8, -7, -257] })).rejects.toThrow(
      "resolveAuthServices: COSE -8 (Ed25519) is configured but this runtime cannot import an Ed25519 key — raise the Worker's compatibility date, or drop -8 from `algorithms`",
    );
  });

  it("throws before the ring resolver is called, so a misconfiguration cannot half-succeed", async () => {
    let calls = 0;
    const resolve = (): KeyRing => {
      calls++;
      return ring();
    };
    await expect(resolveAuthServices(contextFor({}), { ring: resolve, algorithms: [-8] })).rejects.toThrow("COSE -8 (Ed25519) is configured");
    expect(calls).toBe(0);
  });

  it("resolves normally when -8 is not configured", async () => {
    const services = await resolveAuthServices(contextFor({}), { ring: () => ring() });
    expect(services.algorithms).toEqual([-7, -257]);
  });
});

describe("resolveAuthServices — a ring wrapped in createKeyRingResolver", () => {
  interface AppEnv {
    readonly AUTH_SECRET: string;
  }
  const UNWRAP = "resolveAuthServices: pass the `(env) => importKeyRing(…)` function itself, not `createKeyRingResolver(…)`";

  it("is refused at bun check whatever Bindings it was made under, and rejects on first resolve", async () => {
    const inferred: AuthOptions = {
      // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
      ring: createKeyRingResolver(() => ring()),
    };
    const typed: AuthOptions = {
      // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
      ring: createKeyRingResolver<AppEnv>((env) => importAuthKeyRing([env.AUTH_SECRET])),
    };
    await expect(resolveAuthServices(contextFor({}), inferred)).rejects.toThrow(new Error(UNWRAP));
    await expect(resolveAuthServices(contextFor({}), typed)).rejects.toThrow(new Error(UNWRAP));
  });

  it("cast past the type, rejects naming resolveAuthServices and the fix rather than handing the wrapper the env", async () => {
    let resolved = 0;
    const wrapped = createKeyRingResolver(() => {
      resolved++;
      return ring();
    }) as unknown as KeyRingResolver;
    await expect(resolveAuthServices(contextFor({}), { ring: wrapped })).rejects.toThrow(new Error(UNWRAP));
    expect(resolved).toBe(0);
  });

  it("leaves a plain env resolver accepted and handed the env", async () => {
    const secret = "0f328854bb8d3fe151893c6bb80e0298d42b867e556a95190618a51b75d8b8e9";
    const options: AuthOptions<AppEnv> = { ring: (env) => importAuthKeyRing([env.AUTH_SECRET]) };
    const services = await resolveAuthServices(contextFor({ AUTH_SECRET: secret }), options);
    expect(services.keys.activeKeyId).toBe((await importAuthKeyRing([secret])).activeKeyId);
  });
});

describe("resolveAuthServices — a ring still written against the request context", () => {
  const HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";
  const SECRET = "0f328854bb8d3fe151893c6bb80e0298d42b867e556a95190618a51b75d8b8e9";
  const unconverted: { name: string; options: AuthOptions }[] = [
    {
      name: "(c) => importAuthKeyRing([c.env.AUTH_SECRET])",
      // @ts-expect-error — under the default bindings `c.env` is `unknown`, so a stale ring fails `bun check` before it reaches the proxy
      options: { ring: (c) => importAuthKeyRing([c.env.AUTH_SECRET]) },
    },
    {
      name: "(c) => importAuthKeyRing([c.get(…)])",
      // @ts-expect-error — under the default bindings `c.get` is `unknown`, so a stale ring fails `bun check` before it reaches the proxy
      options: { ring: (c) => importAuthKeyRing([c.get("AUTH_SECRET")]) },
    },
  ];

  for (const { name, options } of unconverted) {
    it(`rejects ${name} on the first resolve, naming the rewrite`, async () => {
      await expect(resolveAuthServices(contextFor({ AUTH_SECRET: SECRET }), options)).rejects.toThrow(new Error(HANDED_ENV));
    });
  }

  it("lets a real binding named get through to the ring", async () => {
    const services = await resolveAuthServices(contextFor({ get: SECRET }), { ring: (env: { get: string }) => importAuthKeyRing([env.get]) });
    expect(services.keys.activeKeyId).toBe((await importAuthKeyRing([SECRET])).activeKeyId);
  });
});

describe("AuthOptions — a ring under the default bindings", () => {
  const configStore = createConfig({ secret: { __env: "AUTH_SECRET" } }, v.object({ secret: v.string() }));

  it("refuses a 0.7.7 ring reading a config store off `c.env` at bun check, and takes one reading it off `env`", () => {
    // @ts-expect-error — `c.env` is `unknown` under the default bindings, and `Config.get` takes an object
    const stale: AuthOptions = { ring: (c) => importAuthKeyRing([configStore.get(c.env).secret]) };
    const current: AuthOptions = { ring: (env) => importAuthKeyRing([configStore.get(env).secret]) };
    void [stale, current];
  });

  it("reads any binding as unknown, so importAuthKeyRing refuses it unnarrowed at bun check and keys the ring once it is narrowed", async () => {
    const secret = "8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d";
    // @ts-expect-error — `env.AUTH_SECRET` is `unknown` under the default bindings, and importAuthKeyRing takes strings
    const unnarrowed: AuthOptions = { ring: (env) => importAuthKeyRing([env.AUTH_SECRET]) };
    const narrowed: AuthOptions = { ring: (env) => importAuthKeyRing([String(env.AUTH_SECRET)]) };
    void unnarrowed;
    const services = await resolveAuthServices(contextFor({ AUTH_SECRET: secret }), narrowed);
    expect(services.keys.activeKeyId).toBe((await importAuthKeyRing([secret])).activeKeyId);
  });
});

describe("resolveAuthServices — a ring over the app's Bindings", () => {
  interface Env {
    readonly AUTH_SECRET: string;
  }

  it("refuses a binding Env does not declare at bun check, and takes one it does", () => {
    const missing = () =>
      resolveAuthServices<Env>(contextFor({}), {
        // @ts-expect-error — `AUTH_SECRETS` is not a binding of Env
        ring: (env) => importAuthKeyRing([env.AUTH_SECRETS]),
      });
    const declared = () => resolveAuthServices<Env>(contextFor({}), { ring: (env) => importAuthKeyRing([env.AUTH_SECRET]) });
    void [missing, declared];
  });

  it("takes a ring answered synchronously or as a promise, and refuses one answering anything else at bun check", async () => {
    const held = ring();
    const sync: AuthOptions<Env> = { ring: () => held };
    const promised: AuthOptions<Env> = { ring: async () => held };
    // @ts-expect-error — a promise of the secret is not a promise of a key ring
    const secretOnly: AuthOptions<Env> = { ring: async (env) => env.AUTH_SECRET };
    void secretOnly;
    const ids: string[] = [];
    for (const options of [sync, promised]) ids.push((await resolveAuthServices(contextFor({}), options)).keys.activeKeyId);
    expect(ids).toEqual([held.activeKeyId, held.activeKeyId]);
  });
});
