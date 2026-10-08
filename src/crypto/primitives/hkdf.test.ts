import { describe, expect, it } from "bun:test";

import { hkdfExpand, hkdfExtract } from "./hkdf";
import { bytesToHex, hexToBytes } from "./mod";

function range(from: number, to: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(to - from).map((_, i) => from + i);
}

/** RFC 5869 Appendix A, the three SHA-256 cases. */
const RFC_5869_CASES: readonly {
  name: string;
  ikm: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
  info: Uint8Array<ArrayBuffer>;
  length: number;
  prk: string;
  okm: string;
}[] = [
  {
    name: "A.1 basic",
    ikm: hexToBytes("0b".repeat(22)),
    salt: hexToBytes("000102030405060708090a0b0c"),
    info: hexToBytes("f0f1f2f3f4f5f6f7f8f9"),
    length: 42,
    prk: "077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5",
    okm: "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
  },
  {
    name: "A.2 longer inputs and output",
    ikm: range(0x00, 0x50),
    salt: range(0x60, 0xb0),
    info: range(0xb0, 0x100),
    length: 82,
    prk: "06a6b88c5853361a06104c9ceb35b45cef760014904671014a193f40c15fc244",
    okm: "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87",
  },
  {
    name: "A.3 zero-length salt and info",
    ikm: hexToBytes("0b".repeat(22)),
    salt: new Uint8Array(0),
    info: new Uint8Array(0),
    length: 42,
    prk: "19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04",
    okm: "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
  },
];

describe("hkdfExtract", () => {
  it("produces the exact pseudorandom key of every RFC 5869 Appendix A SHA-256 case", async () => {
    for (const testCase of RFC_5869_CASES) {
      expect(bytesToHex(await hkdfExtract(testCase.ikm, testCase.salt))).toBe(testCase.prk);
    }
  });

  it("treats an empty salt as the zero-filled hash-length salt RFC 5869 §2.2 specifies", async () => {
    const ikm = hexToBytes("0b".repeat(22));
    const explicitZeros = await hkdfExtract(ikm, new Uint8Array(32));
    expect(bytesToHex(await hkdfExtract(ikm, new Uint8Array(0)))).toBe(bytesToHex(explicitZeros));
  });
});

describe("hkdfExpand", () => {
  it("produces the exact output keying material of every RFC 5869 Appendix A SHA-256 case", async () => {
    for (const testCase of RFC_5869_CASES) {
      const prk = await hkdfExtract(testCase.ikm, testCase.salt);
      expect(bytesToHex(await hkdfExpand(prk, testCase.info, testCase.length))).toBe(testCase.okm);
    }
  });

  it("separates two purposes derived from the same pseudorandom key", async () => {
    const prk = await hkdfExtract(hexToBytes("0b".repeat(22)), new Uint8Array(0));
    const first = await hkdfExpand(prk, new TextEncoder().encode("verify"), 32);
    const second = await hkdfExpand(prk, new TextEncoder().encode("identity"), 32);
    expect(bytesToHex(first)).not.toBe(bytesToHex(second));
  });

  it("refuses a length outside RFC 5869's 1..255*HashLen range", async () => {
    const prk = await hkdfExtract(new Uint8Array(32), new Uint8Array(0));
    expect(hkdfExpand(prk, new Uint8Array(0), 0)).rejects.toThrow("hkdfExpand: length must be between 1 and 8160");
    expect(hkdfExpand(prk, new Uint8Array(0), 8161)).rejects.toThrow("hkdfExpand: length must be between 1 and 8160");
  });
});
