import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { importKeyRing, lookupKeyRingKey } from "../../keyring/ring";
import { openAtRest, sealAtRest } from "../../keyring/seal";
import { createTestContext } from "../../testing/context";
import { buildRequest } from "../../testing/request";
import type { AuthKeyRing } from "../types";
import { importAuthKeyRing, resolveAuthServices } from "./ring";

function ring(overrides: Partial<AuthKeyRing> = {}): AuthKeyRing {
  return { activeKeyId: "k1", keys: { k1: new Uint8Array(32).fill(7) }, ...overrides };
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
});

describe("resolveAuthServices", () => {
  it("answers two option sets on one env with their own services, rather than the first caller's", async () => {
    const context = contextFor({ DB: {} });
    const first = { secret: () => ring() };
    const second = { secret: () => ring({ activeKeyId: "k2", keys: { k2: new Uint8Array(32).fill(9) } }) };

    expect((await resolveAuthServices(context, first)).keys.activeKeyId).toBe("k1");
    expect((await resolveAuthServices(context, second)).keys.activeKeyId).toBe("k2");
    expect((await resolveAuthServices(context, first)).keys.activeKeyId).toBe("k1");
  });

  it("builds one option set once per env, so the cache is still a cache", async () => {
    const context = contextFor({ DB: {} });
    let calls = 0;
    const options = {
      secret: () => {
        calls++;
        return ring();
      },
    };
    await resolveAuthServices(context, options);
    await resolveAuthServices(context, options);
    expect(calls).toBe(1);
  });

  it("defaults to the two algorithms every supported runtime can verify", async () => {
    const services = await resolveAuthServices(contextFor({}), { secret: () => ring() });
    expect(services.algorithms).toEqual([-7, -257]);
  });

  it("returns the resolved key ring", async () => {
    const services = await resolveAuthServices(contextFor({}), { secret: () => ring() });
    expect(services.keys.activeKeyId).toBe("k1");
    expect(lookupKeyRingKey(services.keys, "k1")?.byteLength).toBe(32);
  });

  it("awaits an async secret resolver", async () => {
    const services = await resolveAuthServices(contextFor({}), { secret: async () => ring() });
    expect(services.keys.activeKeyId).toBe("k1");
  });

  it("resolves the secret once per env object and reuses it after", async () => {
    const env = {};
    let calls = 0;
    const options = {
      secret: () => {
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
      secret: () => {
        calls++;
        return ring();
      },
    };
    await resolveAuthServices(contextFor({}), options);
    await resolveAuthServices(contextFor({}), options);
    expect(calls).toBe(2);
  });

  it("throws when the ring has no key for its active id", () => {
    const secret = (): AuthKeyRing => ring({ activeKeyId: "k2" });
    expect(resolveAuthServices(contextFor({}), { secret })).rejects.toThrow(
      'resolveAuthServices: the key ring has no key for its active key id "k2"',
    );
  });

  it("throws when the active key id names an inherited property", () => {
    const secret = (): AuthKeyRing => ring({ activeKeyId: "constructor" });
    expect(resolveAuthServices(contextFor({}), { secret })).rejects.toThrow(
      'resolveAuthServices: the key ring has no key for its active key id "constructor"',
    );
  });

  it("throws when any key is shorter than 32 bytes", () => {
    const secret = (): AuthKeyRing => ({ activeKeyId: "k1", keys: { k1: new Uint8Array(32), k0: new Uint8Array(16) } });
    expect(resolveAuthServices(contextFor({}), { secret })).rejects.toThrow(
      'resolveAuthServices: key "k0" is 16 bytes — auth root keys must be at least 32',
    );
  });
});

describe("resolveAuthServices — the Ed25519 capability probe", () => {
  it("accepts -8 on a runtime that can import an Ed25519 key", async () => {
    const services = await resolveAuthServices(contextFor({}), { secret: () => ring(), algorithms: [-8, -7, -257] });
    expect(services.algorithms).toEqual([-8, -7, -257]);
  });
});

// Bun's WebCrypto does support Ed25519, so the unavailable runtime has to be simulated — the same
// swap `src/crypto/mod.test.ts` uses to exercise the `timingSafeEqual` fallback.
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
    expect(resolveAuthServices(contextFor({}), { secret: () => ring(), algorithms: [-8, -7, -257] })).rejects.toThrow(
      "resolveAuthServices: COSE -8 (Ed25519) is configured but this runtime cannot import an Ed25519 key — raise the Worker's compatibility date, or drop -8 from `algorithms`",
    );
  });

  it("throws before the secret resolver is called, so a misconfiguration cannot half-succeed", async () => {
    let calls = 0;
    const secret = (): AuthKeyRing => {
      calls++;
      return ring();
    };
    await expect(resolveAuthServices(contextFor({}), { secret, algorithms: [-8] })).rejects.toThrow("COSE -8 (Ed25519) is configured");
    expect(calls).toBe(0);
  });

  it("resolves normally when -8 is not configured", async () => {
    const services = await resolveAuthServices(contextFor({}), { secret: () => ring() });
    expect(services.algorithms).toEqual([-7, -257]);
  });
});
