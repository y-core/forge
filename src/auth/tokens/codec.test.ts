import { describe, expect, it } from "bun:test";

import { base32Encode, crc32, randomBytes, utf8Encode } from "../../crypto/primitives/mod";
import { assertAccessTokenPrefix, checkAccessToken, formatAccessToken } from "./codec";

const PREFIX = "nt_";

function sample(): string {
  return formatAccessToken(PREFIX, randomBytes(24));
}

/** `token` with the character at `index` swapped for another from the alphabet. */
function flipped(token: string, index: number): string {
  const replacement = token[index] === "A" ? "B" : "A";
  return `${token.slice(0, index)}${replacement}${token.slice(index + 1)}`;
}

describe("formatAccessToken", () => {
  it("spells the prefix, then the base32 secret and checksum in the scanner's alphabet", () => {
    expect(sample()).toMatch(/^nt_[A-Z2-7]{46}$/);
  });

  it("ends in the base32 of the big-endian CRC-32 of everything before it", () => {
    const token = sample();
    const head = token.slice(0, -7);
    const crc = crc32(utf8Encode(head));
    const expected = base32Encode(new Uint8Array([crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]));
    expect(token.slice(-7)).toBe(expected);
  });

  it("spells two secrets as two different tokens", () => {
    expect(sample()).not.toBe(sample());
  });
});

describe("checkAccessToken", () => {
  it("accepts a token it formatted", () => {
    expect(checkAccessToken(PREFIX, sample())).toEqual({ ok: true, data: undefined });
  });

  it("calls anything not shaped like a token malformed", () => {
    const token = sample();
    const tail = token.slice(PREFIX.length);
    const malformed = [
      `gh_${tail}`,
      tail,
      `${PREFIX}${tail.toLowerCase()}`,
      `${PREFIX}${tail.slice(1)}`,
      `${PREFIX}${tail}A`,
      ...["0", "1", "8", "="].map((char) => `${PREFIX}${char}${tail.slice(1)}`),
      "",
      ` ${token}`,
      `${token} `,
    ];
    for (const presented of malformed)
      expect(`${JSON.stringify(presented)}: ${JSON.stringify(checkAccessToken(PREFIX, presented))}`).toBe(
        `${JSON.stringify(presented)}: {"ok":false,"error":"malformed"}`,
      );
  });

  it("calls a well-shaped token with a flipped body or checksum character a checksum mismatch", () => {
    const token = sample();
    expect(checkAccessToken(PREFIX, flipped(token, PREFIX.length + 5))).toEqual({ ok: false, error: "checksum-mismatch" });
    expect(checkAccessToken(PREFIX, flipped(token, token.length - 1))).toEqual({ ok: false, error: "checksum-mismatch" });
  });
});

describe("assertAccessTokenPrefix", () => {
  it("accepts a lowercase letter, then letters or digits, then one underscore, up to seventeen characters", () => {
    for (const prefix of ["nt_", "a1_", `a${"b".repeat(15)}_`]) expect(() => assertAccessTokenPrefix("op", prefix)).not.toThrow();
  });

  it("throws, naming the operation, for any other prefix", () => {
    for (const prefix of ["n_", "Nt_", "1t_", "nt", "nt-", "nt__", `a${"b".repeat(16)}_`]) {
      expect(() => assertAccessTokenPrefix("op", prefix)).toThrow(`op: prefix "${prefix}" must match`);
    }
  });
});
