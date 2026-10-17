import { describe, expect, it } from "bun:test";

import { identifier, template } from "../lint.fixture.ts";
import type { AstNode } from "../types.ts";
import { sqlStatementVerb, sqlTemplateText } from "./sql-text.ts";

const tagged = (tag: string, ...chunks: string[]) =>
  ({ type: "TaggedTemplateExpression", tag: identifier(tag), quasi: template(...chunks) }) as unknown as AstNode;

describe("sqlTemplateText()", () => {
  it("reads an interpolation as ? and drops leading whitespace and comments", () => {
    expect(sqlTemplateText(tagged("sql", "\n  -- why\n  /* how */ DELETE FROM t WHERE id = ", ""))).toBe("DELETE FROM t WHERE id = ?");
  });

  it("ignores every tag but sql", () => {
    expect(sqlTemplateText(tagged("html", "DELETE"))).toBeUndefined();
  });
});

describe("sqlStatementVerb()", () => {
  it("names a plain statement's verb", () => {
    expect([sqlStatementVerb("delete from t"), sqlStatementVerb("SELECT 1")]).toEqual(["DELETE", "SELECT"]);
  });

  it("reads past a WITH clause, including one whose CTE selects, to the statement it feeds", () => {
    expect(sqlStatementVerb("WITH old AS (SELECT id FROM t WHERE stale) DELETE FROM t WHERE id IN (SELECT id FROM old)")).toBe("DELETE");
    expect(sqlStatementVerb("WITH a AS (SELECT 1), b AS (DELETE FROM x) SELECT * FROM a")).toBe("SELECT");
  });

  it("counts no parenthesis inside a string, a quoted name or a comment, and reads no verb there", () => {
    expect(sqlStatementVerb("WITH x AS (SELECT ')' AS c) DELETE FROM t WHERE id IN (SELECT c FROM x)")).toBe("DELETE");
    expect(sqlStatementVerb("WITH x AS (SELECT '(' AS c) DELETE FROM t")).toBe("DELETE");
    expect(sqlStatementVerb("WITH x AS (SELECT 1) /* ) */ DELETE FROM t")).toBe("DELETE");
    expect(sqlStatementVerb('WITH x AS (SELECT 1 AS ")") DELETE FROM t')).toBe("DELETE");
    expect(sqlStatementVerb("WITH x AS (SELECT 1) -- delete\nSELECT 1")).toBe("SELECT");
  });
});
