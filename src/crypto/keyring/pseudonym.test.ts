import { describe, expect, it } from "bun:test";

import { bytesToHex, hexToBytes, hmacSign, utf8Encode } from "../primitives/mod";
import { derivePseudonym, PSEUDONYM_DOMAIN } from "./pseudonym";
import { importKeyRing, importKeyRingUnder, KEY_RING_DOMAIN } from "./ring";
import { resolveKeyRingKey } from "./subkey";
import type { KeyRing } from "./types";

const SECRET_A = "a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8";
const SECRET_B = "49e2bb7eab54cf09b409ffafd3fa8a8a955a60eb972faacaefbed3dbd3207132";

const REQUEST = { purpose: "notes-store", value: "user_01J9Z3" };

function ringOf(...secrets: string[]): Promise<KeyRing> {
  return importKeyRing(secrets as [string, ...string[]]);
}

async function webCryptoPseudonym(rootHex: string, purpose: string, value: Uint8Array<ArrayBuffer>): Promise<string> {
  const label = "y-core/forge/keyring/pseudonym/v1";
  const root = await crypto.subtle.importKey("raw", hexToBytes(rootHex), "HKDF", false, ["deriveBits"]);
  const subkey = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: utf8Encode(label), info: utf8Encode(`${label}/${purpose}`) },
    root,
    256,
  );
  const key = await crypto.subtle.importKey("raw", subkey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, value)));
}

describe("derivePseudonym", () => {
  it("answers the pinned pseudonym for a fixed secret, purpose and value", async () => {
    expect(await derivePseudonym(await ringOf(SECRET_A), REQUEST)).toBe("332bc4d145ba5936b2e602cd4f84c3192b83d08d3ba8f9fceba2e8f647d1cb3a");
  });

  it("answers lowercase hex of HMAC-SHA-256 under the pseudonym subkey, matching raw WebCrypto", async () => {
    const pseudonym = await derivePseudonym(await ringOf(SECRET_A), REQUEST);
    expect(pseudonym).toMatch(/^[0-9a-f]{64}$/);
    expect(pseudonym).toBe(await webCryptoPseudonym(SECRET_A, REQUEST.purpose, utf8Encode(REQUEST.value)));
  });

  it("keys a byte value as given, and a string value as its UTF-8 bytes", async () => {
    const ring = await ringOf(SECRET_A);
    const bytes = new Uint8Array([0, 255, 7]) as Uint8Array<ArrayBuffer>;
    expect(await derivePseudonym(ring, { purpose: REQUEST.purpose, value: bytes })).toBe(
      await webCryptoPseudonym(SECRET_A, REQUEST.purpose, bytes),
    );
    expect(await derivePseudonym(ring, { purpose: REQUEST.purpose, value: utf8Encode(REQUEST.value) })).toBe(await derivePseudonym(ring, REQUEST));
  });

  it("answers the same pseudonym every time, and under a separately imported ring of the same secret", async () => {
    const first = await derivePseudonym(await ringOf(SECRET_A), REQUEST);
    expect(await derivePseudonym(await ringOf(SECRET_A), REQUEST)).toBe(first);
    expect(await derivePseudonym(await ringOf(SECRET_A, SECRET_B), REQUEST)).toBe(first);
  });

  it("answers a different pseudonym for a different purpose, key or value", async () => {
    const ringA = await ringOf(SECRET_A);
    const base = await derivePseudonym(ringA, REQUEST);
    const others = await Promise.all([
      derivePseudonym(ringA, { ...REQUEST, purpose: "audit-log" }),
      derivePseudonym(await ringOf(SECRET_B), REQUEST),
      derivePseudonym(ringA, { ...REQUEST, value: "user_01J9Z4" }),
    ]);
    expect(new Set([base, ...others]).size).toBe(4);
  });

  it("never matches an HMAC under the sealAtRest subkey of the same purpose", async () => {
    const ring = await ringOf(SECRET_A);
    const sealKey = resolveKeyRingKey(ring, { domain: KEY_RING_DOMAIN, kid: ring.activeKeyId, purpose: REQUEST.purpose }, "hmac");
    if (!sealKey) throw new Error("expected the ring to resolve its active key");
    const underSealDomain = bytesToHex(await hmacSign(await sealKey, REQUEST.value));
    expect(PSEUDONYM_DOMAIN.keyIdLabel).toBe(KEY_RING_DOMAIN.keyIdLabel);
    expect(await derivePseudonym(ring, REQUEST)).not.toBe(underSealDomain);
  });

  it("changes every pseudonym on rotation, and reproduces the old one with activeKeyId pinned to the old key", async () => {
    const before = await ringOf(SECRET_A);
    const rotated = await ringOf(SECRET_B, SECRET_A);
    const old = await derivePseudonym(before, REQUEST);
    expect(await derivePseudonym(rotated, REQUEST)).not.toBe(old);
    expect(await derivePseudonym({ ...rotated, activeKeyId: before.activeKeyId }, REQUEST)).toBe(old);
  });
});

describe("derivePseudonym — programming errors", () => {
  it("refuses a ring imported under another domain, naming the auth key ring", async () => {
    const foreign = await importKeyRingUnder("importAuthKeyRing", { keyIdLabel: "y-core/forge/test/kid", subkeyLabel: "y-core/forge/test/v1" }, [
      SECRET_A,
    ]);
    await expect(derivePseudonym(foreign, REQUEST)).rejects.toThrow(
      `derivePseudonym: active key id "${foreign.activeKeyId}" is not one importKeyRing derives — use only a ring importKeyRing built, never the auth key ring`,
    );
  });

  it("refuses a ring holding no key for its active id", async () => {
    await expect(derivePseudonym({ activeKeyId: "AAAAAAAA", keys: {} }, REQUEST)).rejects.toThrow(
      'derivePseudonym: active key id "AAAAAAAA" is not one importKeyRing derives',
    );
  });

  it("throws on an empty purpose", async () => {
    await expect(derivePseudonym(await ringOf(SECRET_A), { ...REQUEST, purpose: "" })).rejects.toThrow(
      "derivePseudonym: purpose must be a non-empty string",
    );
  });
});
