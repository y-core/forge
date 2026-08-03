import { describe, expect, it } from "bun:test";
import { bytesCodec, jsonCodec, textCodec } from "./codec";

describe("jsonCodec", () => {
  it("round-trips objects", () => {
    const codec = jsonCodec<{ x: number }>();
    const encoded = codec.encode({ x: 42 });
    expect(typeof encoded).toBe("string");
    expect(codec.decode(encoded)).toEqual({ x: 42 });
  });

  it("round-trips arrays and primitives", () => {
    const codec = jsonCodec();
    expect(codec.decode(codec.encode([1, 2, 3]))).toEqual([1, 2, 3]);
    expect(codec.decode(codec.encode(null))).toBeNull();
  });

  it("uses text type", () => {
    expect(jsonCodec().type).toBe("text");
  });
});

describe("textCodec", () => {
  it("round-trips strings", () => {
    const codec = textCodec();
    expect(codec.decode(codec.encode("hello"))).toBe("hello");
  });

  it("uses text type", () => {
    expect(textCodec().type).toBe("text");
  });
});

describe("bytesCodec", () => {
  it("round-trips Uint8Array", () => {
    const codec = bytesCodec();
    const original = new Uint8Array([10, 20, 30, 255]);
    const encoded = codec.encode(original);
    expect(encoded).toBeInstanceOf(ArrayBuffer);
    expect(codec.decode(encoded)).toEqual(original);
  });

  it("uses arrayBuffer type", () => {
    expect(bytesCodec().type).toBe("arrayBuffer");
  });
});

describe("bytesCodec — typed-array views", () => {
  it("encodes only the subarray window, not the whole backing buffer", () => {
    const codec = bytesCodec();
    const encoded = codec.encode(new Uint8Array([1, 2, 3, 4, 5, 6]).subarray(2, 4));
    expect((encoded as ArrayBuffer).byteLength).toBe(2);
    expect(Array.from(codec.decode(encoded))).toEqual([3, 4]);
  });

  it("encodes a view with a non-zero byteOffset and the full remaining length", () => {
    const codec = bytesCodec();
    const encoded = codec.encode(new Uint8Array([1, 2, 3, 4, 5, 6]).subarray(3));
    expect((encoded as ArrayBuffer).byteLength).toBe(3);
    expect(Array.from(codec.decode(encoded))).toEqual([4, 5, 6]);
  });

  it("encodes a zero-length view as an empty buffer", () => {
    const codec = bytesCodec();
    const encoded = codec.encode(new Uint8Array([1, 2, 3, 4, 5, 6]).subarray(2, 2));
    expect((encoded as ArrayBuffer).byteLength).toBe(0);
    expect(Array.from(codec.decode(encoded))).toEqual([]);
  });

  it("leaves a whole-buffer Uint8Array unchanged", () => {
    const codec = bytesCodec();
    const encoded = codec.encode(new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect((encoded as ArrayBuffer).byteLength).toBe(6);
    expect(Array.from(codec.decode(encoded))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
