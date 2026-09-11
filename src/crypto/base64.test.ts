import { describe, expect, it } from "bun:test";

import { base64DecodeOrNull, base64Encode, base64urlDecode, base64urlDecodeOrNull, base64urlEncode } from "./base64";

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

describe("base64urlDecodeOrNull", () => {
  it("decodes what base64urlDecode decodes", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    expect(base64urlDecodeOrNull(base64urlEncode(bytes))).toEqual(bytes);
  });

  it("answers null for a string base64urlDecode throws on", () => {
    expect(() => base64urlDecode("a*b")).toThrow();
    expect(base64urlDecodeOrNull("a*b")).toBeNull();
  });

  it("answers an empty array for an empty string", () => {
    expect(base64urlDecodeOrNull("")).toEqual(new Uint8Array(0));
  });
});

// `base64urlEncode` is defined as `base64Encode` with the three substitutions, so this is the
// relationship the shared implementation rests on rather than an incidental one.
describe("base64urlEncode against base64Encode", () => {
  it("is the standard encoding with +, / and = substituted", () => {
    for (let len = 0; len <= 32; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + len * 11) % 256;
      expect(base64urlEncode(bytes)).toBe(base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""));
    }
  });

  it("differs from the standard encoding exactly where the alphabets do", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x01]);
    expect(base64Encode(bytes)).toBe("+/+/AQ==");
    expect(base64urlEncode(bytes)).toBe("-_-_AQ");
  });
});

describe("base64Encode / base64DecodeOrNull", () => {
  it("round-trips arbitrary bytes", () => {
    const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
    expect(base64DecodeOrNull(base64Encode(original))).toEqual(original);
  });

  it("uses the standard alphabet and retains padding", () => {
    expect(base64Encode(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe("+/+/");
    expect(base64Encode(new Uint8Array([1]))).toBe("AQ==");
    expect(base64Encode(new Uint8Array([1, 2]))).toBe("AQI=");
  });

  it("accepts ArrayBuffer input", () => {
    const buf = new Uint8Array([10, 20, 30]).buffer;
    expect(base64DecodeOrNull(base64Encode(buf))).toEqual(new Uint8Array([10, 20, 30]));
  });

  it("answers null for a non-base64 string", () => {
    expect(base64DecodeOrNull("!!!!")).toBeNull();
    expect(base64DecodeOrNull("====")).toBeNull();
    expect(base64DecodeOrNull("a*b")).toBeNull();
  });

  it("rejects the base64url alphabet rather than remapping it", () => {
    expect(base64DecodeOrNull("-_-_")).toBeNull();
  });

  it("answers an empty array for an empty string", () => {
    expect(base64DecodeOrNull("")).toEqual(new Uint8Array(0));
  });
});
