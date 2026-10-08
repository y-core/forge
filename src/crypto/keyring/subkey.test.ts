import { describe, expect, it } from "bun:test";

import { bytesToHex } from "../primitives/mod";
import { HMAC_DOMAIN, importKeyRing, KEY_RING_DOMAIN } from "./ring";
import { resolveKeyRingKey, resolveKeyRingSubkey } from "./subkey";
import type { KeyRing } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";

async function withSubtleRejectingOnce(method: "importKey" | "sign", run: () => Promise<void>): Promise<void> {
  // oxlint-disable-next-line typescript/no-explicit-any -- swapping the platform method for a one-shot failure
  const subtle = crypto.subtle as any;
  const original = subtle[method];
  let failed = false;
  subtle[method] = (...args: unknown[]) => {
    if (failed) return original.apply(crypto.subtle, args);
    failed = true;
    return Promise.reject(new Error("transient WebCrypto failure"));
  };
  try {
    await run();
  } finally {
    subtle[method] = original;
  }
}

async function hexOf(bytes: Promise<Uint8Array<ArrayBuffer>> | undefined): Promise<string> {
  const resolved = await bytes;
  if (!resolved) throw new Error("expected a subkey");
  return bytesToHex(resolved);
}

describe("resolveKeyRingSubkey", () => {
  it("derives a 32-byte subkey, and answers the same request with the same promise", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEY_RING_DOMAIN, kid: ring.activeKeyId, purpose: "webhook-secret" };
    const first = resolveKeyRingSubkey(ring, request);
    expect(first).toBe(resolveKeyRingSubkey(ring, { ...request }));
    expect((await first)?.byteLength).toBe(32);
  });

  it("derives different bytes for a different purpose", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const kid = ring.activeKeyId;
    expect(await hexOf(resolveKeyRingSubkey(ring, { domain: KEY_RING_DOMAIN, kid, purpose: "a" }))).not.toBe(
      await hexOf(resolveKeyRingSubkey(ring, { domain: KEY_RING_DOMAIN, kid, purpose: "b" })),
    );
  });

  it("derives different bytes under a different subkey label for the same kid and purpose", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const kid = ring.activeKeyId;
    const other = { keyIdLabel: KEY_RING_DOMAIN.keyIdLabel, subkeyLabel: "y-core/forge/test/v1" };
    expect(await hexOf(resolveKeyRingSubkey(ring, { domain: KEY_RING_DOMAIN, kid, purpose: "p" }))).not.toBe(
      await hexOf(resolveKeyRingSubkey(ring, { domain: other, kid, purpose: "p" })),
    );
  });

  it("derives forge's HMAC subkeys apart from any sealAtRest purpose of the same name", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const kid = ring.activeKeyId;
    for (const purpose of ["csrf", "signed-url", "signed-cookie/__Host-session"]) {
      expect(await hexOf(resolveKeyRingSubkey(ring, { domain: KEY_RING_DOMAIN, kid, purpose }))).not.toBe(
        await hexOf(resolveKeyRingSubkey(ring, { domain: HMAC_DOMAIN, kid, purpose })),
      );
    }
  });

  it("answers undefined for a kid the ring does not declare, from both resolvers", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEY_RING_DOMAIN, kid: "AAAAAAAA", purpose: "p" };
    expect(resolveKeyRingSubkey(ring, request)).toBeUndefined();
    expect(resolveKeyRingKey(ring, request, "aead")).toBeUndefined();
  });

  it("caches per ring, so two rings naming one kid over different bytes derive different subkeys", async () => {
    const first: KeyRing = { activeKeyId: "k1", keys: { k1: new Uint8Array(32).fill(1) } };
    const second: KeyRing = { activeKeyId: "k1", keys: { k1: new Uint8Array(32).fill(2) } };
    const request = { domain: KEY_RING_DOMAIN, kid: "k1", purpose: "p" };
    expect(await hexOf(resolveKeyRingSubkey(first, request))).not.toBe(await hexOf(resolveKeyRingSubkey(second, request)));
  });

  it("drops a rejected derivation from the cache, so a retry derives afresh", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEY_RING_DOMAIN, kid: ring.activeKeyId, purpose: "p" };
    await withSubtleRejectingOnce("sign", async () => {
      await expect(resolveKeyRingSubkey(ring, request)).rejects.toThrow("transient WebCrypto failure");
    });
    expect((await resolveKeyRingSubkey(ring, request))?.byteLength).toBe(32);
  });
});

describe("resolveKeyRingKey", () => {
  it("imports an AES-GCM key for aead and an HMAC key for hmac, as distinct keys", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEY_RING_DOMAIN, kid: ring.activeKeyId, purpose: "p" };
    const aead = await resolveKeyRingKey(ring, request, "aead");
    const hmac = await resolveKeyRingKey(ring, request, "hmac");
    expect(aead?.algorithm.name).toBe("AES-GCM");
    expect(hmac?.algorithm.name).toBe("HMAC");
    expect(aead).not.toBe(hmac);
  });

  it("re-imports nothing once a key has been resolved", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEY_RING_DOMAIN, kid: ring.activeKeyId, purpose: "p" };
    await resolveKeyRingKey(ring, request, "aead");
    await resolveKeyRingKey(ring, request, "hmac");

    // oxlint-disable-next-line typescript/no-explicit-any -- swapping the platform method for a counter
    const original = (crypto.subtle as any).importKey;
    let imports = 0;
    // oxlint-disable-next-line typescript/no-explicit-any -- swapping the platform method for a counter
    (crypto.subtle as any).importKey = (...args: unknown[]) => {
      imports++;
      return original.apply(crypto.subtle, args);
    };
    try {
      await resolveKeyRingKey(ring, request, "aead");
      await resolveKeyRingKey(ring, { ...request }, "hmac");
      expect(imports).toBe(0);
    } finally {
      // oxlint-disable-next-line typescript/no-explicit-any -- restoring the platform method
      (crypto.subtle as any).importKey = original;
    }
  });

  it("answers a resolved key's repeat request with the same promise", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEY_RING_DOMAIN, kid: ring.activeKeyId, purpose: "p" };
    const first = resolveKeyRingKey(ring, request, "hmac");
    await first;
    expect(resolveKeyRingKey(ring, { ...request }, "hmac")).toBe(first);
  });

  it("drops a rejected import from the cache, so a retry imports a usable key", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEY_RING_DOMAIN, kid: ring.activeKeyId, purpose: "p" };
    await resolveKeyRingSubkey(ring, request);
    await withSubtleRejectingOnce("importKey", async () => {
      await expect(resolveKeyRingKey(ring, request, "hmac")).rejects.toThrow("transient WebCrypto failure");
    });
    const key = await resolveKeyRingKey(ring, request, "hmac");
    if (!key) throw new Error("expected a key");
    const message = new TextEncoder().encode("payload");
    const signature = await crypto.subtle.sign("HMAC", key, message);
    expect(await crypto.subtle.verify("HMAC", key, signature, message)).toBe(true);
  });
});
