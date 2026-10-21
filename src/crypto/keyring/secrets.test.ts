import { describe, expect, it } from "bun:test";

import { v } from "../../validation/mod";
import { KeyRingSecretSchema, parseKeyRingSecrets } from "./secrets";

const NEWER_SECRET = "de7bf4aef360e3a4c3254c9cec7e45d0f1fd98cc2219c62b5b07e826ba1bcc6e";
const OLDER_SECRET = "8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d";

describe("parseKeyRingSecrets", () => {
  it("splits a comma-joined value in order, newest first", () => {
    expect(parseKeyRingSecrets("aa11,bb22,cc33")).toEqual(["aa11", "bb22", "cc33"]);
  });

  it("answers a single secret as a one-entry list", () => {
    expect(parseKeyRingSecrets("aa11")).toEqual(["aa11"]);
  });

  it("trims the whitespace around each entry", () => {
    expect(parseKeyRingSecrets("  aa11 , bb22\n")).toEqual(["aa11", "bb22"]);
  });

  for (const value of ["", "   "]) {
    it(`refuses the empty value ${JSON.stringify(value)}`, () => {
      expect(() => parseKeyRingSecrets(value)).toThrow("parseKeyRingSecrets: the key-ring value is empty");
    });
  }

  for (const value of ["aa11,,bb22", "aa11,", ",aa11", "aa11, ,bb22"]) {
    it(`refuses the empty entry in ${JSON.stringify(value)}`, () => {
      expect(() => parseKeyRingSecrets(value)).toThrow("parseKeyRingSecrets: the key-ring value has an empty entry between its commas");
    });
  }
});

describe("KeyRingSecretSchema", () => {
  const accepted = [
    NEWER_SECRET,
    NEWER_SECRET.toUpperCase(),
    `${NEWER_SECRET}aabb`,
    `${NEWER_SECRET},${OLDER_SECRET}`,
    `${NEWER_SECRET} , ${OLDER_SECRET}`,
  ];
  for (const ring of accepted) {
    it(`accepts ${JSON.stringify(ring)}`, () => {
      expect(v.safeParse(KeyRingSecretSchema, ring).success).toBe(true);
    });
  }

  const refused = [
    "",
    NEWER_SECRET.slice(0, 62),
    `${NEWER_SECRET}a`,
    "z".repeat(64),
    `${NEWER_SECRET},`,
    `${NEWER_SECRET},,${OLDER_SECRET}`,
    `${NEWER_SECRET},${OLDER_SECRET.slice(0, 62)}`,
  ];
  for (const ring of refused) {
    it(`refuses ${JSON.stringify(ring)} with the key-ring message`, () => {
      const result = v.safeParse(KeyRingSecretSchema, ring);
      expect(result.success).toBe(false);
      expect(result.issues?.[0]?.message).toBe("must be comma-separated secrets, each an even number of hex characters, at least 64 (32 bytes)");
    });
  }

  it("refuses a value that is not a string", () => {
    expect(v.safeParse(KeyRingSecretSchema, 42).success).toBe(false);
  });

  for (const ring of [` ${NEWER_SECRET}`, `${NEWER_SECRET} `, `\n${NEWER_SECRET},${OLDER_SECRET}\n`]) {
    it(`accepts ${JSON.stringify(ring)} and answers it trimmed`, () => {
      expect(v.parse(KeyRingSecretSchema, ring)).toBe(ring.trim());
    });
  }

  it("refuses a whitespace-only value with the key-ring message", () => {
    expect(v.safeParse(KeyRingSecretSchema, " \n").issues?.[0]?.message).toBe(
      "must be comma-separated secrets, each an even number of hex characters, at least 64 (32 bytes)",
    );
  });
});
