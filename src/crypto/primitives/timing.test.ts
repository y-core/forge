import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { timingSafeEqual, timingSafeEqualBytes } from "./timing";

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

describe("timingSafeEqualBytes — JS fallback (no native crypto.subtle.timingSafeEqual)", () => {
  // oxlint-disable-next-line typescript/no-explicit-any -- swap the native method out to exercise the fallback path
  const subtleAny = crypto.subtle as any;
  let saved: unknown;

  beforeAll(() => {
    saved = subtleAny.timingSafeEqual;
    subtleAny.timingSafeEqual = undefined;
  });

  afterAll(() => {
    subtleAny.timingSafeEqual = saved;
  });

  it("returns true for identical byte arrays", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3, 4]))).toBe(true);
  });

  it("returns false for same-length different byte arrays", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3, 5]))).toBe(false);
  });

  it("returns false for different-length byte arrays", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });

  it("returns true for both empty byte arrays", () => {
    expect(timingSafeEqualBytes(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});
