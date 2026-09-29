import { describe, expect, it } from "bun:test";

import { hexToBytes, randomBytes, utf8Encode } from "./bytes";
import { assertSecretStrength, SECRET_MIN_BYTES } from "./strength";

describe("assertSecretStrength", () => {
  it("accepts a CSPRNG secret at the floor", () => {
    expect(() => assertSecretStrength("op", randomBytes(SECRET_MIN_BYTES))).not.toThrow();
  });

  it("accepts a typed passphrase of at least 32 bytes", () => {
    expect(() => assertSecretStrength("op", utf8Encode("correct horse battery staple, v2!"))).not.toThrow();
  });

  it("refuses a secret one byte under the floor, naming its length", () => {
    expect(() => assertSecretStrength("op", randomBytes(SECRET_MIN_BYTES - 1))).toThrow("op: each secret must be at least 32 bytes (got 31)");
  });

  it("refuses a secret whose bytes are all the same value", () => {
    expect(() => assertSecretStrength("op", new Uint8Array(64).fill(0x61))).toThrow(
      "op: a secret whose bytes are all the same value is not a secret",
    );
  });

  it("refuses a secret carrying fewer than eight distinct byte values, naming the count it found", () => {
    expect(() => assertSecretStrength("op", hexToBytes("01020304050607".repeat(5)))).toThrow(
      "op: a secret carrying only 7 distinct byte values is not one a CSPRNG produced — at least 8 are required",
    );
  });

  it("accepts a secret carrying exactly eight distinct byte values", () => {
    expect(() => assertSecretStrength("op", hexToBytes("0123456789abcdef".repeat(4)))).not.toThrow();
  });
});
