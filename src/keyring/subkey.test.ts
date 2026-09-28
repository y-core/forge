import { describe, expect, it } from "bun:test";

import { bytesToHex } from "../crypto/mod";
import { importKeyRing, KEYRING_DOMAIN } from "./ring";
import { resolveKeyRingKey, resolveKeyRingSubkey } from "./subkey";
import type { KeyRing } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";

async function hexOf(bytes: Promise<Uint8Array<ArrayBuffer>> | undefined): Promise<string> {
  const resolved = await bytes;
  if (!resolved) throw new Error("expected a subkey");
  return bytesToHex(resolved);
}

describe("resolveKeyRingSubkey", () => {
  it("derives a 32-byte subkey, and answers the same request with the same promise", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEYRING_DOMAIN, kid: ring.activeKeyId, purpose: "webhook-secret" };
    const first = resolveKeyRingSubkey(ring, request);
    expect(first).toBe(resolveKeyRingSubkey(ring, { ...request }));
    expect((await first)?.byteLength).toBe(32);
  });

  it("derives different bytes for a different purpose", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const kid = ring.activeKeyId;
    expect(await hexOf(resolveKeyRingSubkey(ring, { domain: KEYRING_DOMAIN, kid, purpose: "a" }))).not.toBe(
      await hexOf(resolveKeyRingSubkey(ring, { domain: KEYRING_DOMAIN, kid, purpose: "b" })),
    );
  });

  it("derives different bytes under a different subkey label for the same kid and purpose", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const kid = ring.activeKeyId;
    const other = { keyIdLabel: KEYRING_DOMAIN.keyIdLabel, subkeyLabel: "y-core/forge/test/v1" };
    expect(await hexOf(resolveKeyRingSubkey(ring, { domain: KEYRING_DOMAIN, kid, purpose: "p" }))).not.toBe(
      await hexOf(resolveKeyRingSubkey(ring, { domain: other, kid, purpose: "p" })),
    );
  });

  it("answers undefined for a kid the ring does not declare, from both resolvers", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEYRING_DOMAIN, kid: "AAAAAAAA", purpose: "p" };
    expect(resolveKeyRingSubkey(ring, request)).toBeUndefined();
    expect(resolveKeyRingKey(ring, request, "aead")).toBeUndefined();
  });

  it("caches per ring, so two rings naming one kid over different bytes derive different subkeys", async () => {
    const first: KeyRing = { activeKeyId: "k1", keys: { k1: new Uint8Array(32).fill(1) } };
    const second: KeyRing = { activeKeyId: "k1", keys: { k1: new Uint8Array(32).fill(2) } };
    const request = { domain: KEYRING_DOMAIN, kid: "k1", purpose: "p" };
    expect(await hexOf(resolveKeyRingSubkey(first, request))).not.toBe(await hexOf(resolveKeyRingSubkey(second, request)));
  });
});

describe("resolveKeyRingKey", () => {
  it("imports an AES-GCM key for aead and an HMAC key for hmac, as distinct keys", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEYRING_DOMAIN, kid: ring.activeKeyId, purpose: "p" };
    const aead = await resolveKeyRingKey(ring, request, "aead");
    const hmac = await resolveKeyRingKey(ring, request, "hmac");
    expect(aead?.algorithm.name).toBe("AES-GCM");
    expect(hmac?.algorithm.name).toBe("HMAC");
    expect(aead).not.toBe(hmac);
  });

  it("re-imports nothing once a key has been resolved", async () => {
    const ring = await importKeyRing([SECRET_A]);
    const request = { domain: KEYRING_DOMAIN, kid: ring.activeKeyId, purpose: "p" };
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
});
