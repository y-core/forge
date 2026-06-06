import { beforeAll, describe, expect, it } from "bun:test";
import {
  base64urlDecode,
  base64urlEncode,
  bytesToHex,
  hexToBytes,
  hmacSign,
  hmacVerify,
  importHmacKeyFromHex,
  randomBytes,
  sha256,
  timingSafeEqual,
  timingSafeEqualBytes,
  utf8Decode,
  utf8Encode,
} from "./mod";

// Polyfill Cloudflare Workers' crypto.subtle.timingSafeEqual for Bun test runtime.
beforeAll(() => {
  if (typeof crypto.subtle.timingSafeEqual === "function") return;
  crypto.subtle.timingSafeEqual = (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean => {
    const bufA = ArrayBuffer.isView(a) ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength) : new Uint8Array(a);
    const bufB = ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b);
    if (bufA.byteLength !== bufB.byteLength) {
      throw new TypeError("Input buffers must have the same byte length");
    }
    let result = 0;
    for (let i = 0; i < bufA.byteLength; i++) result |= bufA[i]! ^ bufB[i]!;
    return result === 0;
  };
});

describe("base64urlEncode / base64urlDecode", () => {
  it("round-trips arbitrary bytes", () => {
    const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
    expect(base64urlDecode(base64urlEncode(original))).toEqual(original);
  });

  it("produces no padding characters", () => {
    for (let len = 1; len <= 6; len++) {
      const bytes = new Uint8Array(len).fill(0xab);
      const encoded = base64urlEncode(bytes);
      expect(encoded).not.toContain("=");
      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
    }
  });

  it("decodes padded base64url (1-byte input)", () => {
    const bytes = new Uint8Array([42]);
    const encoded = base64urlEncode(bytes);
    expect(base64urlDecode(encoded)).toEqual(bytes);
  });

  it("decodes padded base64url (2-byte input)", () => {
    const bytes = new Uint8Array([0xde, 0xad]);
    expect(base64urlDecode(base64urlEncode(bytes))).toEqual(bytes);
  });

  it("accepts ArrayBuffer input", () => {
    const buf = new Uint8Array([10, 20, 30]).buffer;
    expect(base64urlDecode(base64urlEncode(buf))).toEqual(new Uint8Array([10, 20, 30]));
  });
});

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("secret-token", "secret-token")).toBe(true);
  });

  it("returns false for same-length different content", () => {
    expect(timingSafeEqual("secret-token", "wrong!-token")).toBe(false);
  });

  it("returns false when first string is longer", () => {
    expect(timingSafeEqual("longer-string", "short")).toBe(false);
  });

  it("returns false when second string is longer", () => {
    expect(timingSafeEqual("short", "longer-string")).toBe(false);
  });

  it("returns true for both empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("returns false when one is empty and the other is not", () => {
    expect(timingSafeEqual("", "non-empty")).toBe(false);
    expect(timingSafeEqual("non-empty", "")).toBe(false);
  });

  it("handles unicode and multi-byte characters", () => {
    expect(timingSafeEqual("café", "café")).toBe(true);
    expect(timingSafeEqual("café", "cafe")).toBe(false);
    expect(timingSafeEqual("日本語", "日本語")).toBe(true);
    expect(timingSafeEqual("日本語", "日本人")).toBe(false);
  });
});

describe("timingSafeEqualBytes", () => {
  it("returns true for identical byte arrays", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(timingSafeEqualBytes(a, b)).toBe(true);
  });

  it("returns false for same-length different byte arrays", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(timingSafeEqualBytes(a, b)).toBe(false);
  });

  it("returns false for different-length byte arrays", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(timingSafeEqualBytes(a, b)).toBe(false);
  });

  it("returns true for both empty byte arrays", () => {
    const a = new Uint8Array([]);
    const b = new Uint8Array([]);
    expect(timingSafeEqualBytes(a, b)).toBe(true);
  });
});

describe("utf8Encode / utf8Decode", () => {
  it("round-trips ASCII", () => {
    const s = "hello world";
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });

  it("round-trips multi-byte characters", () => {
    const s = "日本語";
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });

  it("produces correct byte length for multi-byte input", () => {
    // "日本語" encodes to 9 bytes in UTF-8 (3 bytes per CJK character)
    expect(utf8Encode("日本語").byteLength).toBe(9);
  });
});

describe("bytesToHex / hexToBytes", () => {
  it("round-trips arbitrary bytes", () => {
    const original = new Uint8Array([0x00, 0x0f, 0x10, 0xab, 0xff]);
    expect(hexToBytes(bytesToHex(original))).toEqual(original);
  });

  it("produces lowercase zero-padded output", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });

  it("decodes a known hex string", () => {
    expect(hexToBytes("deadbeef")).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });
});

describe("randomBytes", () => {
  it("returns the requested byte length", () => {
    expect(randomBytes(16).byteLength).toBe(16);
    expect(randomBytes(32).byteLength).toBe(32);
  });

  it("two consecutive calls produce different values", () => {
    const a = randomBytes(16);
    const b = randomBytes(16);
    expect(a).not.toEqual(b);
  });
});

describe("sha256", () => {
  it("returns 32 bytes", async () => {
    expect((await sha256("")).byteLength).toBe(32);
  });

  it("matches the known SHA-256 digest of an empty string", async () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const hex = bytesToHex(await sha256(""));
    expect(hex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("accepts Uint8Array input", async () => {
    const viaString = await sha256("abc");
    const viaBytes = await sha256(utf8Encode("abc"));
    expect(viaBytes).toEqual(viaString);
  });
});

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
