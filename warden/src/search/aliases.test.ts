import { describe, expect, it } from "bun:test";

import { ALIASES, aliasesFor, aliasTerms, APPS, LIBS, SHARED } from "./aliases";

describe("ALIASES", () => {
  it("keys every entry in lower case, so a lookup needs no normalisation twice", () => {
    for (const key of ALIASES.keys()) expect(key).toBe(key.toLowerCase());
  });

  it("never maps a term to itself, which would be a bridge to nowhere", () => {
    for (const [key, values] of ALIASES) expect(values.map((v) => v.toLowerCase())).not.toContain(key);
  });
});

describe("the three tables", () => {
  it("unions into ALIASES, so no bridge can live in a table nothing loads", () => {
    for (const table of [SHARED, LIBS, APPS]) {
      for (const [term, targets] of table) {
        for (const target of targets) expect(ALIASES.get(term)).toContain(target);
      }
    }
  });

  // A bridge is OR-ed into every query that triggers its term, so one aimed at a vocabulary the
  // corpus lacks is noise on a real question — which is what the split is for.
  it("serves a library the shared table plus its own, and an application the shared table alone", () => {
    expect(aliasesFor("libs").get("handler")).toEqual(["controller", "definePage", "defineAction"]);
    expect(aliasesFor("apps").get("handler")).toEqual(["controller"]);
  });

  it("keeps a term bridged by two tables rather than letting one shadow the other", () => {
    expect(SHARED.get("logging")).toEqual(["channel", "PII"]);
    expect(LIBS.get("logging")).toEqual(["requestLogger"]);
    expect(aliasesFor("libs").get("logging")).toEqual(["channel", "PII", "requestLogger"]);
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

  it("bridges through the table it is given, not through every bridge in the file", () => {
    expect(aliasTerms(["handler"], aliasesFor("apps"))).toEqual(["controller"]);
  });
});

describe("placement bridges", () => {
  it("reaches the growth rules from the words a placement question is asked in", () => {
    expect(aliasTerms(["put"])).toContain("growth");
    expect(aliasTerms(["belongs"], aliasesFor("libs"))).toContain("classification");
  });

  it("still never displaces the reader's own term", () => {
    expect(aliasTerms(["growth", "put"])).not.toContain("growth");
  });
});
