import { describe, expect, it } from "bun:test";

import { AEAD_NONCE_BYTES, AEAD_TAG_BYTES, aeadNonce, aeadOpen, aeadSeal, importAeadKey } from "./aead";
import { randomBytes, utf8Decode, utf8Encode } from "./mod";

const PLAINTEXT = utf8Encode("aurora@example.test");

async function sealed(): Promise<{ key: CryptoKey; nonce: Uint8Array<ArrayBuffer>; bytes: Uint8Array<ArrayBuffer> }> {
  const key = await importAeadKey(randomBytes(32));
  const nonce = aeadNonce();
  return { key, nonce, bytes: await aeadSeal(key, nonce, PLAINTEXT) };
}

function flip(bytes: Uint8Array<ArrayBuffer>, index: number): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes);
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

describe("aeadNonce", () => {
  it("returns 12 bytes and does not repeat across calls", () => {
    expect(aeadNonce().byteLength).toBe(AEAD_NONCE_BYTES);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(aeadNonce().join(","));
    expect(seen.size).toBe(100);
  });
});

describe("importAeadKey", () => {
  it("refuses key material that is not 32 bytes", () => {
    expect(() => importAeadKey(randomBytes(16))).toThrow("importAeadKey: AES-256-GCM requires a 32-byte key");
    expect(() => importAeadKey(randomBytes(31))).toThrow("importAeadKey: AES-256-GCM requires a 32-byte key");
  });
});

describe("aeadSeal and aeadOpen", () => {
  it("round-trips plaintext and appends exactly one tag length", async () => {
    const { key, nonce, bytes } = await sealed();
    expect(bytes.byteLength).toBe(PLAINTEXT.byteLength + AEAD_TAG_BYTES);
    expect(utf8Decode((await aeadOpen(key, nonce, bytes)) ?? new Uint8Array(0))).toBe("aurora@example.test");
  });

  it("round-trips with associated data bound in", async () => {
    const key = await importAeadKey(randomBytes(32));
    const nonce = aeadNonce();
    const aad = utf8Encode("v1|verify");
    const bytes = await aeadSeal(key, nonce, PLAINTEXT, aad);
    expect(utf8Decode((await aeadOpen(key, nonce, bytes, aad)) ?? new Uint8Array(0))).toBe("aurora@example.test");
  });

  it("returns null for a corrupted ciphertext byte", async () => {
    const { key, nonce, bytes } = await sealed();
    expect(await aeadOpen(key, nonce, flip(bytes, 0))).toBeNull();
  });

  it("returns null for a corrupted tag byte", async () => {
    const { key, nonce, bytes } = await sealed();
    expect(await aeadOpen(key, nonce, flip(bytes, bytes.byteLength - 1))).toBeNull();
  });

  it("returns null under a different key", async () => {
    const { nonce, bytes } = await sealed();
    expect(await aeadOpen(await importAeadKey(randomBytes(32)), nonce, bytes)).toBeNull();
  });

  it("returns null under a different nonce", async () => {
    const { key, bytes } = await sealed();
    expect(await aeadOpen(key, aeadNonce(), bytes)).toBeNull();
  });

  it("returns null when the associated data differs from the sealed one", async () => {
    const key = await importAeadKey(randomBytes(32));
    const nonce = aeadNonce();
    const bytes = await aeadSeal(key, nonce, PLAINTEXT, utf8Encode("v1|verify"));
    expect(await aeadOpen(key, nonce, bytes, utf8Encode("v1|identity"))).toBeNull();
  });

  it("returns null for input too short to hold a tag", async () => {
    const key = await importAeadKey(randomBytes(32));
    expect(await aeadOpen(key, aeadNonce(), randomBytes(AEAD_TAG_BYTES - 1))).toBeNull();
  });
});
