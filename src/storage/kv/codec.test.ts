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
