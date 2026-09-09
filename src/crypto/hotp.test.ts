import { describe, expect, it } from "bun:test";

import { type HotpHash, hotpCode, totpCode, totpCounter } from "./hotp";
import { utf8Encode } from "./mod";

/** RFC 4226 Appendix D uses this one 20-byte ASCII secret for every counter. */
const RFC_4226_SECRET = utf8Encode("12345678901234567890");

/** RFC 4226 Appendix D, counters 0–9. */
const RFC_4226_CODES: readonly string[] = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];

// RFC 6238 Appendix B uses a *different* secret per variant, each the ASCII digits repeated to the
// hash's block size. Reusing the SHA-1 secret for all three yields a table that passes for the
// wrong reason: HMAC pads a short key, so the wrong-length secret still produces a stable code.
/** RFC 6238 Appendix B, one secret per hash variant. */
const RFC_6238_SECRETS: Readonly<Record<HotpHash, Uint8Array<ArrayBuffer>>> = {
  "SHA-1": utf8Encode("12345678901234567890"),
  "SHA-256": utf8Encode("12345678901234567890123456789012"),
  "SHA-512": utf8Encode("1234567890123456789012345678901234567890123456789012345678901234"),
};

/** RFC 6238 Appendix B, every row: 8 digits, T0 = 0, X = 30. */
const RFC_6238_ROWS: readonly { seconds: number; hash: HotpHash; code: string }[] = [
  { seconds: 59, hash: "SHA-1", code: "94287082" },
  { seconds: 59, hash: "SHA-256", code: "46119246" },
  { seconds: 59, hash: "SHA-512", code: "90693936" },
  { seconds: 1_111_111_109, hash: "SHA-1", code: "07081804" },
  { seconds: 1_111_111_109, hash: "SHA-256", code: "68084774" },
  { seconds: 1_111_111_109, hash: "SHA-512", code: "25091201" },
  { seconds: 1_111_111_111, hash: "SHA-1", code: "14050471" },
  { seconds: 1_111_111_111, hash: "SHA-256", code: "67062674" },
  { seconds: 1_111_111_111, hash: "SHA-512", code: "99943326" },
  { seconds: 1_234_567_890, hash: "SHA-1", code: "89005924" },
  { seconds: 1_234_567_890, hash: "SHA-256", code: "91819424" },
  { seconds: 1_234_567_890, hash: "SHA-512", code: "93441116" },
  { seconds: 2_000_000_000, hash: "SHA-1", code: "69279037" },
  { seconds: 2_000_000_000, hash: "SHA-256", code: "90698825" },
  { seconds: 2_000_000_000, hash: "SHA-512", code: "38618901" },
  { seconds: 20_000_000_000, hash: "SHA-1", code: "65353130" },
  { seconds: 20_000_000_000, hash: "SHA-256", code: "77737706" },
  { seconds: 20_000_000_000, hash: "SHA-512", code: "47863826" },
];

describe("hotpCode", () => {
  it("matches every RFC 4226 Appendix D code for counters 0 through 9", async () => {
    for (const [counter, code] of RFC_4226_CODES.entries()) {
      expect(await hotpCode(RFC_4226_SECRET, counter)).toBe(code);
    }
  });

  it("accepts a bigint counter identically to the number form", async () => {
    expect(await hotpCode(RFC_4226_SECRET, 9n)).toBe("520489");
  });

  it("zero-pads a code whose truncated value is short", async () => {
    const code = await hotpCode(RFC_6238_SECRETS["SHA-1"], 37_037_036, { digits: 8 });
    expect(code).toBe("07081804");
    expect(code.length).toBe(8);
  });

  it("refuses a digit count outside 6 to 10", () => {
    expect(hotpCode(RFC_4226_SECRET, 0, { digits: 5 })).rejects.toThrow("hotpCode: digits must be an integer between 6 and 10");
    expect(hotpCode(RFC_4226_SECRET, 0, { digits: 11 })).rejects.toThrow("hotpCode: digits must be an integer between 6 and 10");
  });

  it("refuses a negative counter", () => {
    expect(hotpCode(RFC_4226_SECRET, -1)).rejects.toThrow("hotpCode: counter must not be negative");
  });
});

describe("totpCode", () => {
  it("matches every RFC 6238 Appendix B row, each against that variant's own secret", async () => {
    for (const { seconds, hash, code } of RFC_6238_ROWS) {
      expect(await totpCode(RFC_6238_SECRETS[hash], seconds, { digits: 8, hash })).toBe(code);
    }
  });

  it("returns the same code for every second inside one period and a different one across the boundary", async () => {
    const secret = RFC_6238_SECRETS["SHA-1"];
    const options = { digits: 8, hash: "SHA-1" } as const;
    expect(await totpCode(secret, 30, options)).toBe(await totpCode(secret, 59, options));
    expect(await totpCode(secret, 60, options)).not.toBe(await totpCode(secret, 59, options));
  });

  it("shifts the counter by an explicit epoch", async () => {
    const secret = RFC_6238_SECRETS["SHA-1"];
    const options = { digits: 8, hash: "SHA-1" } as const;
    expect(await totpCode(secret, 1_000_000_059, { ...options, epoch: 1_000_000_000 })).toBe("94287082");
  });

  it("refuses a non-positive period and a reading before the epoch", () => {
    expect(totpCode(RFC_4226_SECRET, 59, { period: 0 })).rejects.toThrow("totpCode: period must be a positive whole number of seconds");
    expect(totpCode(RFC_4226_SECRET, 10, { epoch: 20 })).rejects.toThrow("totpCode: seconds must not precede the epoch");
  });
});

describe("totpCounter", () => {
  it("reports the RFC 6238 counter each Appendix B reading falls in", () => {
    const cases: readonly { seconds: number; counter: number }[] = [
      { seconds: 59, counter: 0x1 },
      { seconds: 1_111_111_109, counter: 0x023_523_ec },
      { seconds: 1_111_111_111, counter: 0x023_523_ed },
      { seconds: 1_234_567_890, counter: 0x027_3ef_07 },
      { seconds: 2_000_000_000, counter: 0x03f_940_aa },
      { seconds: 20_000_000_000, counter: 0x27b_c86_aa },
    ];
    for (const { seconds, counter } of cases) {
      expect(totpCounter(seconds)).toBe(counter);
    }
  });
});
