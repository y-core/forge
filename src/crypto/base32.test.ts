import { describe, expect, it } from "bun:test";

import { base32Decode, base32Encode } from "./base32";
import { utf8Decode, utf8Encode } from "./mod";

/** RFC 4648 §10, with the padding stripped — forge emits and accepts the unpadded form. */
const RFC_4648_VECTORS: readonly { input: string; encoded: string; padded: string }[] = [
  { input: "", encoded: "", padded: "" },
  { input: "f", encoded: "MY", padded: "MY======" },
  { input: "fo", encoded: "MZXQ", padded: "MZXQ====" },
  { input: "foo", encoded: "MZXW6", padded: "MZXW6===" },
  { input: "foob", encoded: "MZXW6YQ", padded: "MZXW6YQ=" },
  { input: "fooba", encoded: "MZXW6YTB", padded: "MZXW6YTB" },
  { input: "foobar", encoded: "MZXW6YTBOI", padded: "MZXW6YTBOI======" },
];

describe("base32Encode", () => {
  it("matches every RFC 4648 §10 vector exactly, unpadded", () => {
    for (const { input, encoded } of RFC_4648_VECTORS) {
      expect(base32Encode(utf8Encode(input))).toBe(encoded);
    }
  });
});

describe("base32Decode", () => {
  it("recovers every RFC 4648 §10 vector from the unpadded form", () => {
    for (const { input, encoded } of RFC_4648_VECTORS) {
      expect(utf8Decode(base32Decode(encoded))).toBe(input);
    }
  });

  it("recovers every RFC 4648 §10 vector from the padded form", () => {
    for (const { input, padded } of RFC_4648_VECTORS) {
      expect(utf8Decode(base32Decode(padded))).toBe(input);
    }
  });

  it("accepts lowercase, which is how a user retypes an enrolment secret", () => {
    expect(utf8Decode(base32Decode("mzxw6ytboi"))).toBe("foobar");
  });

  it("rejects a character outside the alphabet rather than skipping it", () => {
    expect(() => base32Decode("MZXW6YTB0I")).toThrow('base32Decode: "0" is not a base32 character');
    expect(() => base32Decode("MZXW6!")).toThrow('base32Decode: "!" is not a base32 character');
    expect(() => base32Decode("MZXW 6")).toThrow('base32Decode: " " is not a base32 character');
  });

  it("round-trips arbitrary bytes for every length that changes the trailing-bit case", () => {
    for (let length = 0; length <= 16; length++) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) & 0xff);
      expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
    }
  });
});
