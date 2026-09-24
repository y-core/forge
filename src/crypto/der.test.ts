import { describe, expect, it } from "bun:test";

import { unwrapEcdsaSignature } from "./der";
import { bytesToHex, hexToBytes } from "./mod";

// Built byte by byte from known r and s rather than captured from a signer: WebCrypto's ECDSA
// emits raw `r‖s` and never DER, so there is no output to capture.
function derSignature(rHex: string, sHex: string): Uint8Array<ArrayBuffer> {
  const integer = (hex: string): string => `02${(hex.length / 2).toString(16).padStart(2, "0")}${hex}`;
  const body = integer(rHex) + integer(sHex);
  return hexToBytes(`30${(body.length / 2).toString(16).padStart(2, "0")}${body}`);
}

/** 32 bytes with the high bit set, so a DER encoder prefixes a 0x00 sign byte. */
const HIGH_R = `e1${"a1".repeat(31)}`;
const HIGH_S = `f2${"c3".repeat(31)}`;
/** 32 bytes with the high bit clear, so DER encodes them as they are. */
const LOW_R = `41${"b2".repeat(31)}`;
const LOW_S = `22${"d4".repeat(31)}`;
/** Short integers: a coordinate whose leading bytes happened to be zero, which DER drops. */
const SHORT_R = `3a${"5b".repeat(30)}`;
const SHORT_S = `17${"6c".repeat(29)}`;

const CASES: readonly { name: string; der: Uint8Array<ArrayBuffer>; length: number; expected: string }[] = [
  { name: "70 bytes — neither integer padded", der: derSignature(LOW_R, LOW_S), length: 70, expected: LOW_R + LOW_S },
  { name: "71 bytes — r padded, s not", der: derSignature(`00${HIGH_R}`, LOW_S), length: 71, expected: HIGH_R + LOW_S },
  { name: "71 bytes — s padded, r not", der: derSignature(LOW_R, `00${HIGH_S}`), length: 71, expected: LOW_R + HIGH_S },
  { name: "72 bytes — both integers padded", der: derSignature(`00${HIGH_R}`, `00${HIGH_S}`), length: 72, expected: HIGH_R + HIGH_S },
  {
    name: "31-byte r — the case a left-aligning implementation corrupts",
    der: derSignature(SHORT_R, LOW_S),
    length: 69,
    expected: `00${SHORT_R}${LOW_S}`,
  },
  { name: "31-byte r and 30-byte s together", der: derSignature(SHORT_R, SHORT_S), length: 67, expected: `00${SHORT_R}0000${SHORT_S}` },
  {
    name: "single-byte r — the extreme of the short-integer case",
    der: derSignature("07", LOW_S),
    length: 39,
    expected: `${"00".repeat(31)}07${LOW_S}`,
  },
];

describe("unwrapEcdsaSignature", () => {
  it("produces exactly 64 right-aligned bytes for every DER length", () => {
    for (const { der, length, expected } of CASES) {
      expect(der.byteLength).toBe(length);
      const raw = unwrapEcdsaSignature(der);
      expect(raw.byteLength).toBe(64);
      expect(bytesToHex(raw)).toBe(expected);
    }
  });

  it("keeps a zero-valued integer as a full run of zero bytes", () => {
    expect(bytesToHex(unwrapEcdsaSignature(derSignature("00", LOW_S)))).toBe(`${"00".repeat(32)}${LOW_S}`);
  });

  it("refuses a payload that is not an ASN.1 SEQUENCE", () => {
    expect(() => unwrapEcdsaSignature(hexToBytes("3145"))).toThrow("unwrapEcdsaSignature: expected an ASN.1 SEQUENCE");
  });

  it("refuses a SEQUENCE whose declared length disagrees with the input", () => {
    const der = derSignature(LOW_R, LOW_S);
    der[1] = 0x40;
    expect(() => unwrapEcdsaSignature(der)).toThrow("unwrapEcdsaSignature: declared SEQUENCE length does not match the input");
  });

  it("refuses a body element that is not an ASN.1 INTEGER", () => {
    const der = derSignature(LOW_R, LOW_S);
    der[2] = 0x04;
    expect(() => unwrapEcdsaSignature(der)).toThrow("unwrapEcdsaSignature: expected an ASN.1 INTEGER");
  });

  it("refuses an integer wider than the curve's coordinate", () => {
    expect(() => unwrapEcdsaSignature(derSignature(`01${HIGH_R}`, LOW_S))).toThrow(
      "unwrapEcdsaSignature: integer is wider than the curve's coordinate",
    );
  });

  it("refuses an integer that runs past the end of the signature", () => {
    const der = derSignature(LOW_R, LOW_S);
    der[3] = 0x60;
    expect(() => unwrapEcdsaSignature(der)).toThrow("unwrapEcdsaSignature: ASN.1 INTEGER runs past the end of the signature");
  });

  it("refuses trailing bytes after the second integer", () => {
    const body = `02${(LOW_R.length / 2).toString(16)}${LOW_R}02${(LOW_S.length / 2).toString(16)}${LOW_S}ff`;
    expect(() => unwrapEcdsaSignature(hexToBytes(`30${(body.length / 2).toString(16)}${body}`))).toThrow(
      "unwrapEcdsaSignature: trailing bytes after the second integer",
    );
  });
});
