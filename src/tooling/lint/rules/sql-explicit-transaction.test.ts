import { describe, expect, it } from "bun:test";

import { identifier, nextLoc, other, runRule, template } from "../test-support.ts";
import type { AstNode } from "../types.ts";
import { sqlExplicitTransaction } from "./sql-explicit-transaction.ts";

function tagged(tag: string, ...chunks: string[]): AstNode {
  const quasi = template(...chunks);
  return { type: "TaggedTemplateExpression", loc: nextLoc(), tag: identifier(tag), quasi, children: [quasi] } as unknown as AstNode;
}

const message = (keyword: string) =>
  `\`sql\`${keyword} …\`\` opens an explicit transaction, which D1 refuses inside the implicit one it already holds — put the statements in one \`batch()\` instead (docs/STORAGE_BINDINGS.md §1g).`;

describe("sql-explicit-transaction", () => {
  it("reports a fragment that opens a transaction", () => {
    expect(runRule(sqlExplicitTransaction, tagged("sql", "BEGIN"))).toEqual([message("BEGIN")]);
  });

  it("reports a commit whatever its case and leading whitespace", () => {
    expect(runRule(sqlExplicitTransaction, tagged("sql", " commit"))).toEqual([message("COMMIT")]);
  });

  it("reads past a leading SQL comment", () => {
    expect(runRule(sqlExplicitTransaction, tagged("sql", "-- note\nROLLBACK"))).toEqual([message("ROLLBACK")]);
    expect(runRule(sqlExplicitTransaction, tagged("sql", "/* why */ END TRANSACTION"))).toEqual([message("END")]);
  });

  it("reports a savepoint and its release, which nest a transaction the same way", () => {
    expect(runRule(sqlExplicitTransaction, tagged("sql", "SAVEPOINT a"))).toEqual([message("SAVEPOINT")]);
    expect(runRule(sqlExplicitTransaction, tagged("sql", "RELEASE a"))).toEqual([message("RELEASE")]);
  });

  it("reports an interpolated fragment whose first chunk opens the transaction", () => {
    expect(runRule(sqlExplicitTransaction, tagged("sql", "BEGIN; UPDATE t SET a = ", ""))).toEqual([message("BEGIN")]);
  });

  it("accepts an ordinary statement", () => {
    expect(runRule(sqlExplicitTransaction, tagged("sql", "SELECT 1"))).toEqual([]);
    expect(runRule(sqlExplicitTransaction, tagged("sql", "UPDATE t SET a = ", " WHERE id = ", ""))).toEqual([]);
  });

  it("accepts a trigger body", () => {
    const trigger = "CREATE TRIGGER t_after AFTER INSERT ON t BEGIN UPDATE t SET n = n + 1; END";
    expect(runRule(sqlExplicitTransaction, tagged("sql", trigger))).toEqual([]);
  });

  it("accepts a keyword that only prefixes a longer word", () => {
    expect(runRule(sqlExplicitTransaction, tagged("sql", "ENDORSE"))).toEqual([]);
  });

  it("leaves a template with another tag alone", () => {
    expect(runRule(sqlExplicitTransaction, tagged("html", "BEGIN"))).toEqual([]);
  });

  it("leaves an untagged template alone", () => {
    expect(runRule(sqlExplicitTransaction, other("Program", template("BEGIN")))).toEqual([]);
  });

  it("accepts an empty fragment", () => {
    expect(runRule(sqlExplicitTransaction, tagged("sql", ""))).toEqual([]);
  });
});
