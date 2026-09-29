import { describe, expect, it } from "bun:test";

import { hexToBytes, randomBytes, utf8Encode } from "./bytes";
import { hmacSign, hmacVerify, importHmacKey, importHmacKeyFromHex, importHmacKeyRing, lookupHmacKey } from "./hmac";

const HEX_A = "358b1487d61f45faee7d40c46f2e735451bdee612b02576b37426d8b4617d48d";
const HEX_B = "a4be059a6bf8f74efeb3c721902802870bb3aa5ec060fea9241d201f1e4e27d4";

describe("importHmacKeyFromHex", () => {
  const validHex = HEX_A;

  it("resolves a CryptoKey for a 32-byte hex secret", async () => {
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

  it("rejects with label when the secret is under 32 bytes", async () => {
    await expect(importHmacKeyFromHex(HEX_A.slice(0, 62), "secret")).rejects.toThrow("secret: each secret must be at least 32 bytes (got 31)");
  });

  it("rejects with label when every byte of the secret is the same value", async () => {
    await expect(importHmacKeyFromHex("a".repeat(64), "secret")).rejects.toThrow(
      "secret: a secret whose bytes are all the same value is not a secret",
    );
  });

  it("rejects with label when the secret carries too few distinct byte values", async () => {
    await expect(importHmacKeyFromHex("0102".repeat(16), "secret")).rejects.toThrow(
      "secret: a secret carrying only 2 distinct byte values is not one a CSPRNG produced",
    );
  });
});

describe("hmacSign / hmacVerify", () => {
  it("sign then verify round-trips as true", async () => {
    const key = await importHmacKeyFromHex(HEX_A, "secret");
    const sig = await hmacSign(key, "test payload");
    expect(await hmacVerify(key, "test payload", sig)).toBe(true);
  });

  it("returns false when data is tampered", async () => {
    const key = await importHmacKeyFromHex(HEX_A, "secret");
    const sig = await hmacSign(key, "test payload");
    expect(await hmacVerify(key, "tampered payload", sig)).toBe(false);
  });

  it("returns false when signature is tampered", async () => {
    const key = await importHmacKeyFromHex(HEX_A, "secret");
    const sig = await hmacSign(key, "test payload");
    sig[0]! ^= 0xff;
    expect(await hmacVerify(key, "test payload", sig)).toBe(false);
  });

  it("accepts Uint8Array data", async () => {
    const key = await importHmacKeyFromHex(HEX_B, "secret");
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
    const hex = HEX_A;
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
    const ring = await importHmacKeyRing([HEX_A], "Label");
    expect(ring.activeKeyId).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("carries the label into an odd-length secret's error", async () => {
    await expect(importHmacKeyRing(["abc"], "Label")).rejects.toThrow("Label must have an even number of hex characters");
  });

  it("carries the label into a non-hex secret's error", async () => {
    await expect(importHmacKeyRing(["zz".repeat(16)], "Label")).rejects.toThrow("Label must contain only hexadecimal characters (0-9, a-f, A-F)");
  });

  it("carries the label into a short secret's error", async () => {
    await expect(importHmacKeyRing(["aabb"], "Label")).rejects.toThrow("Label: each secret must be at least 32 bytes (got 2)");
  });

  it("rejects an empty secret list, naming the label", async () => {
    await expect(importHmacKeyRing([] as never, "Label")).rejects.toThrow("Label: a key ring requires at least one secret");
  });
});

describe("lookupHmacKey", () => {
  it("resolves a present kid and nothing else, prototype names included", async () => {
    const ring = await importHmacKeyRing([HEX_A], "Label");
    expect(lookupHmacKey(ring, ring.activeKeyId)).toBe(ring.keys[ring.activeKeyId]!);
    for (const kid of ["absent-kid00", "constructor", "__proto__", "toString"]) {
      expect(lookupHmacKey(ring, kid)).toBeUndefined();
    }
  });
});
