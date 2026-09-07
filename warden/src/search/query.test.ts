import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { matchExpression, terms } from "./query";

describe("terms()", () => {
  it("keeps an identifier whole, punctuation and all", () => {
    expect(terms("does ui/core use forge-ui-focus-ring in §5c")).toEqual(["ui/core", "use", "forge-ui-focus-ring", "§5c"]);
  });

  it("drops the stop words a corpus of rules carries everywhere", () => {
    expect(terms("what is the rule for this")).toEqual(["rule"]);
  });

  it("keeps the stop words when they are all a query has, so it still matches something", () => {
    expect(terms("what is this")).toEqual(["what", "is", "this"]);
  });

  it("trims sentence punctuation, because the index trims it too", () => {
    expect(terms("the budget.")).toEqual(["budget"]);
    expect(terms("read mod.ts")).toEqual(["read", "mod.ts"]);
  });

  it("returns nothing for a query with no term in it at all", () => {
    expect(terms("!!! ???")).toEqual([]);
  });
});

describe("matchExpression()", () => {
  it("ORs the reader's own terms, each quoted so none can read as syntax", () => {
    expect(matchExpression("barrel namespace")).toBe('"barrel" OR "namespace"');
  });

  it("appends the alias bridges in their own group, after the terms actually typed", () => {
    expect(matchExpression("throw")).toBe('"throw" OR ("Result" OR "err" OR "ok")');
  });

  it("stays a valid FTS5 expression whatever punctuation or operator the reader types", () => {
    // A query is data here, never an expression the reader gets to write: the term pattern admits
    // no quote, parenthesis or star, and every term is quoted on top of that. `NEAR` survives as a
    // quoted literal term rather than as the operator.
    const db = new Database(":memory:");
    db.run("CREATE VIRTUAL TABLE t USING fts5(a)");
    db.run("INSERT INTO t VALUES ('nothing in particular')");

    for (const hostile of ['say "no"', "a OR b*", "NEAR(a b)", "^anchor", "x AND y", "a NOT b"]) {
      expect(() => db.query("SELECT rowid FROM t WHERE t MATCH ?").all(matchExpression(hostile))).not.toThrow();
    }
    db.close();
  });

  it("is empty for a query with no term, so a caller returns nothing rather than everything", () => {
    expect(matchExpression("!!!")).toBe("");
  });
});
