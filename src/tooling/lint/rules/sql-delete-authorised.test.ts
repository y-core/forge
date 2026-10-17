import { describe, expect, it } from "bun:test";

import { identifier, template } from "../lint.fixture.ts";
import type { AstNode } from "../types.ts";
import { sqlDeleteAuthorised } from "./sql-delete-authorised.ts";

const MESSAGE =
  "a `sql` DELETE removes rows for good — say who authorised it in a `// row-removal-authorised-by: <who or why>` comment on the line before the fragment.";

/** Lints one `tag\`…\`` on line 10, with the given comments ending on the given lines. */
function lint(tag: string, chunks: string[], comments: { line: number; value: string; type?: string }[] = []): string[] {
  const reported: string[] = [];
  const visitor = sqlDeleteAuthorised.create({
    report: (diagnostic) => reported.push(diagnostic.message),
    sourceCode: {
      getDisableDirectives: () => ({ directives: [] }),
      getAllComments: () =>
        comments.map(({ line, value, type }) => ({ type: type ?? "Line", value, loc: { start: { line, column: 0 }, end: { line, column: 1 } } })),
    },
  });
  const node = {
    type: "TaggedTemplateExpression",
    loc: { start: { line: 10, column: 0 }, end: { line: 10, column: 1 } },
    tag: identifier(tag),
    quasi: template(...chunks),
  } as unknown as AstNode;
  visitor.TaggedTemplateExpression?.(node);
  return reported;
}

describe("sql-delete-authorised", () => {
  it("reports a plain DELETE with no authorisation", () => {
    expect(lint("sql", ["DELETE FROM sessions WHERE expires_at < ", ""])).toEqual([MESSAGE]);
  });

  it("reports a DELETE fed by a WITH clause", () => {
    expect(lint("sql", ["WITH old AS (SELECT id FROM t WHERE stale = 1) DELETE FROM t WHERE id IN (SELECT id FROM old)"])).toEqual([MESSAGE]);
  });

  it("accepts a DELETE whose line before carries the authorisation", () => {
    expect(
      lint("sql", ["DELETE FROM sessions WHERE id = ", ""], [{ line: 9, value: " row-removal-authorised-by: session expiry, decision-261015-07" }]),
    ).toEqual([]);
  });

  it("does not accept an authorisation two lines up, an empty one, or a block comment", () => {
    expect(lint("sql", ["DELETE FROM t"], [{ line: 8, value: " row-removal-authorised-by: ops" }])).toEqual([MESSAGE]);
    expect(lint("sql", ["DELETE FROM t"], [{ line: 9, value: " row-removal-authorised-by:" }])).toEqual([MESSAGE]);
    expect(lint("sql", ["DELETE FROM t"], [{ line: 9, value: " row-removal-authorised-by: ops ", type: "Block" }])).toEqual([MESSAGE]);
  });

  it("says nothing about a statement that is not a DELETE, a WITH feeding a SELECT, or another tag", () => {
    expect(lint("sql", ["UPDATE t SET deleted_at = ", ""])).toEqual([]);
    expect(lint("sql", ["WITH gone AS (SELECT id FROM t) SELECT * FROM gone"])).toEqual([]);
    expect(lint("html", ["DELETE FROM t"])).toEqual([]);
  });
});
