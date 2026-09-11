import { describe, expect, it } from "bun:test";

import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8Decode, utf8Encode } from "./bytes";

describe("concatBytes", () => {
  it("joins parts in the order given", () => {
    expect(concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5]))).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("skips empty parts without disturbing the offsets", () => {
    expect(concatBytes(new Uint8Array(0), new Uint8Array([7]), new Uint8Array(0), new Uint8Array([8, 9]))).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("answers an empty array for no parts at all", () => {
    expect(concatBytes()).toEqual(new Uint8Array(0));
  });

  it("copies rather than aliasing, so a later write to a part does not reach the result", () => {
    const part = new Uint8Array([1, 2]);
    const joined = concatBytes(part);
    part[0] = 99;
    expect(joined).toEqual(new Uint8Array([1, 2]));
  });

  it("reads a subarray by its own window, not its backing buffer", () => {
    expect(concatBytes(new Uint8Array([1, 2, 3, 4]).subarray(1, 3))).toEqual(new Uint8Array([2, 3]));
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
