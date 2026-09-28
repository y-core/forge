import { describe, expect, it } from "bun:test";

import { hexToBytes, randomBytes, utf8Encode } from "./bytes";
import { hmacSign, hmacVerify, importHmacKey, importHmacKeyFromHex, importHmacKeyRing, lookupHmacKey } from "./hmac";

describe("importHmacKeyFromHex", () => {
  const validHex = "a".repeat(32); // 16 bytes

  it("resolves a CryptoKey for valid 32-char hex", async () => {
    const key = await importHmacKeyFromHex(validHex, "secret");
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.algorithm.name).toBe("HMAC");
  });

  it("rejects with label when hex length is odd", async () => {
    await expect(importHmacKeyFromHex("abc", "secret")).rejects.toThrow("secret must have an even number of hex characters");
  });

  it("rejects with label when hex contains non-hex characters", async () => {
    await expect(importHmacKeyFromHex("zz".repeat(16), "secret")).rejects.toThrow(
      "secret must contain only hexadecimal characters (0-9, a-f, A-F)",
    );
  });

  it("rejects with label when hex is fewer than 32 chars (< 16 bytes)", async () => {
    await expect(importHmacKeyFromHex("aabb", "secret")).rejects.toThrow("secret must be at least 32 hex characters (16 bytes)");
  });
});

describe("hmacSign / hmacVerify", () => {
  it("sign then verify round-trips as true", async () => {
    const key = await importHmacKeyFromHex("a".repeat(32), "secret");
    const sig = await hmacSign(key, "test payload");
    expect(await hmacVerify(key, "test payload", sig)).toBe(true);
  });

  it("returns false when data is tampered", async () => {
    const key = await importHmacKeyFromHex("a".repeat(32), "secret");
    const sig = await hmacSign(key, "test payload");
    expect(await hmacVerify(key, "tampered payload", sig)).toBe(false);
  });

  it("returns false when signature is tampered", async () => {
    const key = await importHmacKeyFromHex("a".repeat(32), "secret");
    const sig = await hmacSign(key, "test payload");
    sig[0]! ^= 0xff;
    expect(await hmacVerify(key, "test payload", sig)).toBe(false);
  });

  it("accepts Uint8Array data", async () => {
    const key = await importHmacKeyFromHex("b".repeat(32), "secret");
    const data = utf8Encode("binary data");
    const sig = await hmacSign(key, data);
    expect(await hmacVerify(key, data, sig)).toBe(true);
  });
});

describe("importHmacKey", () => {
  it("imports raw bytes as a signing key that round-trips sign/verify", async () => {
    const key = await importHmacKey(randomBytes(32));
    const sig = await hmacSign(key, "payload");
    expect(await hmacVerify(key, "payload", sig)).toBe(true);
    expect(await hmacVerify(key, "tampered", sig)).toBe(false);
  });

  it("produces the same signatures as importHmacKeyFromHex for equal key material", async () => {
    const hex = "ab".repeat(16);
    const fromHex = await importHmacKeyFromHex(hex, "secret");
    const fromBytes = await importHmacKey(hexToBytes(hex));
    expect(await hmacSign(fromBytes, "x")).toEqual(await hmacSign(fromHex, "x"));
  });
});

describe("importHmacKeyRing", () => {
  const s1 = "0123456789abcdef".repeat(4);
  const s2 = "fedcba9876543210".repeat(4);

  it("makes the first secret's kid active and holds every secret's kid", async () => {
    const ring = await importHmacKeyRing([s1, s2], "Label");
    const firstOnly = await importHmacKeyRing([s1], "Label");
    const secondOnly = await importHmacKeyRing([s2], "Label");
    expect(ring.activeKeyId).toBe(firstOnly.activeKeyId);
    expect(Object.keys(ring.keys).sort()).toEqual([firstOnly.activeKeyId, secondOnly.activeKeyId].sort());
    expect(firstOnly.activeKeyId).not.toBe(secondOnly.activeKeyId);
  });

  it("derives known-answer kids, case-insensitively", async () => {
    expect((await importHmacKeyRing([s1], "Label")).activeKeyId).toBe("qK5ubukpq-o6");
    expect((await importHmacKeyRing([s1.toUpperCase()], "Label")).activeKeyId).toBe("qK5ubukpq-o6");
    expect((await importHmacKeyRing([s2], "Label")).activeKeyId).toBe("e50H8kBLECs8");
  });

  it("derives a twelve-character base64url kid", async () => {
    const ring = await importHmacKeyRing(["ab".repeat(32)], "Label");
    expect(ring.activeKeyId).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("carries the label into an odd-length secret's error", async () => {
    await expect(importHmacKeyRing(["abc"], "Label")).rejects.toThrow("Label must have an even number of hex characters");
  });

  it("carries the label into a non-hex secret's error", async () => {
    await expect(importHmacKeyRing(["zz".repeat(16)], "Label")).rejects.toThrow("Label must contain only hexadecimal characters (0-9, a-f, A-F)");
  });

  it("carries the label into a short secret's error", async () => {
    await expect(importHmacKeyRing(["aabb"], "Label")).rejects.toThrow("Label must be at least 32 hex characters (16 bytes)");
  });

  it("rejects an empty secret list, naming the label", async () => {
    await expect(importHmacKeyRing([] as never, "Label")).rejects.toThrow("Label: a key ring requires at least one secret");
  });
});

describe("lookupHmacKey", () => {
  it("resolves a present kid and nothing else, prototype names included", async () => {
    const ring = await importHmacKeyRing(["ab".repeat(32)], "Label");
    expect(lookupHmacKey(ring, ring.activeKeyId)).toBe(ring.keys[ring.activeKeyId]!);
    for (const kid of ["absent-kid00", "constructor", "__proto__", "toString"]) {
      expect(lookupHmacKey(ring, kid)).toBeUndefined();
    }
  });
});
