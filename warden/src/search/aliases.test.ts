import { describe, expect, it } from "bun:test";

import { ALIASES, aliasTerms } from "./aliases";

describe("ALIASES", () => {
  it("keys every entry in lower case, so a lookup needs no normalisation twice", () => {
    for (const key of ALIASES.keys()) expect(key).toBe(key.toLowerCase());
  });

  it("never maps a term to itself, which would be a bridge to nowhere", () => {
    for (const [key, values] of ALIASES) expect(values.map((v) => v.toLowerCase())).not.toContain(key);
  });
});

describe("aliasTerms()", () => {
  it("bridges the paraphrase a lexical index alone cannot reach", () => {
    expect(aliasTerms(["throw"])).toEqual(["Result", "err", "ok"]);
  });

  it("never returns a term the reader already typed", () => {
    expect(aliasTerms(["throw", "Result"])).toEqual(["err", "ok"]);
  });

  it("is case-insensitive on the way in and deduplicated on the way out", () => {
    expect(aliasTerms(["THROW", "throws"])).toEqual(["Result", "err", "ok"]);
  });

  it("returns nothing for terms it has no bridge for", () => {
    expect(aliasTerms(["barrel", "namespace"])).toEqual([]);
  });
});

describe("placement bridges", () => {
  it("reaches the growth rules from the words a placement question is asked in", () => {
    expect(aliasTerms(["put"])).toContain("growth");
    expect(aliasTerms(["belongs"])).toContain("classification");
  });

  it("still never displaces the reader's own term", () => {
    expect(aliasTerms(["growth", "put"])).not.toContain("growth");
  });
});
