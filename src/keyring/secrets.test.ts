import { describe, expect, it } from "bun:test";

import { keyRingSecrets } from "./secrets";

describe("keyRingSecrets", () => {
  it("splits a comma-joined value in order, newest first", () => {
    expect(keyRingSecrets("aa11,bb22,cc33")).toEqual(["aa11", "bb22", "cc33"]);
  });

  it("answers a single secret as a one-entry list", () => {
    expect(keyRingSecrets("aa11")).toEqual(["aa11"]);
  });

  it("trims the whitespace around each entry", () => {
    expect(keyRingSecrets("  aa11 , bb22\n")).toEqual(["aa11", "bb22"]);
  });

  for (const value of ["", "   "]) {
    it(`refuses the empty value ${JSON.stringify(value)}`, () => {
      expect(() => keyRingSecrets(value)).toThrow("keyRingSecrets: the key-ring value is empty");
    });
  }

  for (const value of ["aa11,,bb22", "aa11,", ",aa11", "aa11, ,bb22"]) {
    it(`refuses the empty entry in ${JSON.stringify(value)}`, () => {
      expect(() => keyRingSecrets(value)).toThrow("keyRingSecrets: the key-ring value has an empty entry between its commas");
    });
  }
});
