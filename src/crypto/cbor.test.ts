import { describe, expect, it } from "bun:test";

import { type CborValue, cborDecodeFirst } from "./cbor";
import { hexToBytes } from "./mod";

/** RFC 8949 Appendix A, the rows this decoder's subset covers. */
const RFC_8949_VECTORS: readonly { hex: string; value: CborValue }[] = [
  { hex: "00", value: 0 },
  { hex: "01", value: 1 },
  { hex: "17", value: 23 },
  { hex: "1818", value: 24 },
  { hex: "1903e8", value: 1000 },
  { hex: "1a000f4240", value: 1_000_000 },
  { hex: "1b000000e8d4a51000", value: 1_000_000_000_000 },
  { hex: "1bffffffffffffffff", value: 18_446_744_073_709_551_615n },
  { hex: "20", value: -1 },
  { hex: "29", value: -10 },
  { hex: "3903e7", value: -1000 },
  { hex: "f4", value: false },
  { hex: "f5", value: true },
  { hex: "f6", value: null },
  { hex: "f7", value: undefined },
  { hex: "f90000", value: 0 },
  { hex: "f93c00", value: 1 },
  { hex: "f9c400", value: -4 },
  { hex: "fa47c35000", value: 100_000 },
  { hex: "fb3ff199999999999a", value: 1.1 },
  { hex: "6161", value: "a" },
  { hex: "6449455446", value: "IETF" },
];

describe("cborDecodeFirst — scalars", () => {
  it("decodes every covered RFC 8949 Appendix A vector to the exact value", () => {
    for (const { hex, value } of RFC_8949_VECTORS) {
      expect(cborDecodeFirst(hexToBytes(hex)).value).toEqual(value);
    }
  });

  it("consumes exactly the item's bytes", () => {
    for (const { hex } of RFC_8949_VECTORS) {
      expect(cborDecodeFirst(hexToBytes(hex)).bytesRead).toBe(hex.length / 2);
    }
  });
});

describe("cborDecodeFirst — containers", () => {
  it("decodes a byte string to its exact bytes", () => {
    const decoded = cborDecodeFirst(hexToBytes("4401020304"));
    expect(decoded.value).toBeInstanceOf(Uint8Array);
    expect([...(decoded.value as Uint8Array)]).toEqual([1, 2, 3, 4]);
    expect(decoded.bytesRead).toBe(5);
  });

  it("decodes an array of arrays", () => {
    expect(cborDecodeFirst(hexToBytes("8301820203820405")).value).toEqual([1, [2, 3], [4, 5]]);
  });

  it("decodes a map as a Map, so an integer label stays an integer key", () => {
    const decoded = cborDecodeFirst(hexToBytes("a201022003")).value;
    expect(decoded).toBeInstanceOf(Map);
    const entries = decoded as Map<CborValue, CborValue>;
    expect(entries.get(1)).toBe(2);
    expect(entries.get(-1)).toBe(3);
    expect(entries.get("1")).toBeUndefined();
    expect(entries.get("-1")).toBeUndefined();
  });

  it("unwraps a tagged value to the value it tags", () => {
    expect(cborDecodeFirst(hexToBytes("c11a514b67b0")).value).toBe(1_363_896_240);
  });
});

describe("cborDecodeFirst — boundary reporting", () => {
  it("reports bytesRead below the input length when the item is followed by trailing bytes", () => {
    // The shape authenticator data has: a COSE key, then the extension bytes that follow it.
    const input = hexToBytes("a201022003" + "deadbeef");
    const decoded = cborDecodeFirst(input);
    expect(decoded.bytesRead).toBe(5);
    expect(decoded.bytesRead).toBeLessThan(input.length);
    expect([...input.subarray(decoded.bytesRead)]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});

describe("cborDecodeFirst — refusals", () => {
  it("refuses an indefinite-length item, which CTAP2 canonical CBOR forbids", () => {
    expect(() => cborDecodeFirst(hexToBytes("5f42010243030405ff"))).toThrow("cborDecodeFirst: unsupported additional information 31");
    expect(() => cborDecodeFirst(hexToBytes("9f018202039f0203ffff"))).toThrow("cborDecodeFirst: unsupported additional information 31");
  });

  it("refuses input that ends inside a value", () => {
    expect(() => cborDecodeFirst(hexToBytes("4401"))).toThrow("cborDecodeFirst: input ended inside a value");
    expect(() => cborDecodeFirst(hexToBytes("a20102"))).toThrow("cborDecodeFirst: input ended inside a value");
  });

  it("refuses a reserved additional-information value", () => {
    expect(() => cborDecodeFirst(hexToBytes("1c"))).toThrow("cborDecodeFirst: unsupported additional information 28");
  });
});
