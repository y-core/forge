import { describe, expect, it } from "bun:test";

import { base64urlDecode, hexToBytes } from "../crypto/mod";
import { importKeyRing, importKeyRingUnder, KEYRING_DOMAIN, keyRingKeyId, lookupKeyRingKey } from "./ring";
import type { KeyRing } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";
const SECRET_B = "49e2bb7eab54cf09b409ffafd3fa8a8a955a60eb972faacaefbed3dbd3207132";

function ringOf(...secrets: string[]): Promise<KeyRing> {
  return importKeyRing(secrets as [string, ...string[]]);
}

describe("importKeyRing", () => {
  it("derives an eight-character base64url key id that decodes to exactly six bytes", async () => {
    const ring = await ringOf(SECRET_A);
    expect(ring.activeKeyId).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(base64urlDecode(ring.activeKeyId).byteLength).toBe(6);
  });

  it("makes the first secret active and keeps every secret readable", async () => {
    const ring = await ringOf(SECRET_A, SECRET_B);
    const [soloA, soloB] = await Promise.all([ringOf(SECRET_A), ringOf(SECRET_B)]);
    expect(ring.activeKeyId).toBe(soloA.activeKeyId);
    expect(Object.keys(ring.keys).toSorted()).toEqual([soloA.activeKeyId, soloB.activeKeyId].toSorted());
  });

  it("keeps the old key id readable when a new secret is prepended", async () => {
    const before = await ringOf(SECRET_A);
    const after = await ringOf(SECRET_B, SECRET_A);
    expect(after.activeKeyId).not.toBe(before.activeKeyId);
    expect(lookupKeyRingKey(after, before.activeKeyId)).toEqual(before.keys[before.activeKeyId] as Uint8Array<ArrayBuffer>);
  });

  it("derives a different key id for the same secret under a different domain", async () => {
    const root = hexToBytes(SECRET_A);
    const other = { keyIdLabel: "y-core/forge/test/kid", subkeyLabel: KEYRING_DOMAIN.subkeyLabel };
    expect(await keyRingKeyId(KEYRING_DOMAIN, root)).not.toBe(await keyRingKeyId(other, root));
  });
});

describe("importKeyRing — refusals", () => {
  it("refuses a secret that is odd-length or not hex", async () => {
    await expect(ringOf("abc")).rejects.toThrow("importKeyRing: each secret must be an even-length hex string");
    await expect(ringOf("zz".repeat(32))).rejects.toThrow("importKeyRing: each secret must be an even-length hex string");
  });

  it("refuses a secret under 32 bytes", async () => {
    await expect(ringOf("a1".repeat(16))).rejects.toThrow("importKeyRing: each secret must be at least 32 bytes (got 16)");
  });

  it("refuses a secret whose bytes are all the same value", async () => {
    await expect(ringOf("00".repeat(32))).rejects.toThrow("importKeyRing: a secret whose bytes are all the same value is not a secret");
  });

  it("refuses a secret drawn from too small an alphabet, naming the count it found", async () => {
    await expect(ringOf("0102".repeat(16))).rejects.toThrow(
      "importKeyRing: a secret carrying only 2 distinct byte values is not one a CSPRNG produced",
    );
  });

  it("refuses a degenerate secret even when a good one comes first", async () => {
    await expect(ringOf(SECRET_A, "00".repeat(32))).rejects.toThrow("is not a secret");
  });

  it("refuses an empty list", async () => {
    await expect(importKeyRing([] as unknown as [string, ...string[]])).rejects.toThrow("importKeyRing: at least one secret is required");
  });

  it("names the operation it was called under in every refusal", async () => {
    await expect(importKeyRingUnder("importAuthKeyRing", KEYRING_DOMAIN, ["00".repeat(32)])).rejects.toThrow(
      "importAuthKeyRing: a secret whose bytes are all the same value is not a secret",
    );
    await expect(importKeyRingUnder("importAuthKeyRing", KEYRING_DOMAIN, [])).rejects.toThrow("importAuthKeyRing: at least one secret is required");
  });
});

describe("lookupKeyRingKey", () => {
  const ring: KeyRing = { activeKeyId: "k1", keys: { k1: new Uint8Array(32).fill(7) } };

  it("returns the key a ring declares", () => {
    expect(lookupKeyRingKey(ring, "k1")?.byteLength).toBe(32);
  });

  it("returns undefined for an id the ring does not declare", () => {
    expect(lookupKeyRingKey(ring, "k9")).toBeUndefined();
  });

  it("returns undefined for an inherited property name, so `constructor` cannot resolve", () => {
    for (const kid of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(lookupKeyRingKey(ring, kid)).toBeUndefined();
    }
  });
});
