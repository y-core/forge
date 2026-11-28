import { describe, expect, it } from "bun:test";

import { call, callOn, identifier, member, nextLoc, runRule, template } from "../lint.fixture.ts";
import type { AstNode } from "../types.ts";
import { sqlTagCalledDirectly } from "./sql-tag-called-directly.ts";

const message =
  "[forge-sql-tag-called-directly] `sql(…)` called as a function builds a fragment from caller text that no `?` binds — write the statement as a `sql`…`` template, and map a column or direction onto fixed fragments.";

describe("sql-tag-called-directly", () => {
  it("reports sql called with an array of strings", () => {
    expect(runRule(sqlTagCalledDirectly, call("sql", identifier("parts")))).toEqual([message]);
  });

  it("accepts sql used as a template tag", () => {
    const quasi = template("SELECT 1");
    const tagged = { type: "TaggedTemplateExpression", loc: nextLoc(), tag: identifier("sql"), quasi, children: [quasi] } as unknown as AstNode;
    expect(runRule(sqlTagCalledDirectly, tagged)).toEqual([]);
  });

  it("leaves another function and a method named sql alone", () => {
    expect(runRule(sqlTagCalledDirectly, call("sqlText", identifier("x")))).toEqual([]);
    expect(runRule(sqlTagCalledDirectly, callOn(member(identifier("knex"), "sql"), identifier("x")))).toEqual([]);
  });
});
