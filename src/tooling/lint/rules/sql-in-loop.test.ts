import { describe, expect, it } from "bun:test";

import { callOn, identifier, member, nextLoc, other, runRule } from "../lint.fixture.ts";
import type { AstNode } from "../types.ts";
import { sqlInLoop } from "./sql-in-loop.ts";

const d1Call = (method: string) => callOn(member(identifier("db"), method), identifier("fragment"));
const awaited = (node: AstNode) => other("AwaitExpression", node);

function loop(type: string, parts: { body?: AstNode; init?: AstNode; right?: AstNode; test?: AstNode }): AstNode {
  const children = [parts.init, parts.right, parts.test, parts.body].filter((part) => part !== undefined);
  return { type, loc: nextLoc(), ...parts, children } as unknown as AstNode;
}

function arrow(body: AstNode): AstNode {
  return { type: "ArrowFunctionExpression", loc: nextLoc(), async: true, body, children: [body] } as unknown as AstNode;
}

const message = (method: string, where: string) =>
  `[forge-sql-in-loop] \`.${method}(…)\` runs once per item ${where} — read every key in one statement through \`json_each\`, or load them through \`createRowLoader\`.`;

describe("sql-in-loop", () => {
  it("reports each D1 read or write awaited in the body of every loop form", () => {
    for (const type of ["ForStatement", "ForOfStatement", "ForInStatement", "WhileStatement", "DoWhileStatement"]) {
      expect(runRule(sqlInLoop, loop(type, { body: other("BlockStatement", awaited(d1Call("queryOne"))) }))).toEqual([
        message("queryOne", "of a loop"),
      ]);
    }
  });

  it("reports a call awaited in a while loop's test, which runs on every pass", () => {
    expect(runRule(sqlInLoop, loop("WhileStatement", { test: awaited(d1Call("query")), body: other("BlockStatement") }))).toEqual([
      message("query", "of a loop"),
    ]);
  });

  it("accepts the call a for…of iterates over and a for loop's init, which run once", () => {
    expect(runRule(sqlInLoop, loop("ForOfStatement", { right: awaited(d1Call("query")), body: other("BlockStatement") }))).toEqual([]);
    expect(runRule(sqlInLoop, loop("ForStatement", { init: awaited(d1Call("execute")), body: other("BlockStatement") }))).toEqual([]);
  });

  it("accepts a call made in a loop and not awaited there, which a later batch or Promise can gather", () => {
    expect(runRule(sqlInLoop, loop("ForOfStatement", { body: other("BlockStatement", d1Call("execute")) }))).toEqual([]);
  });

  it("reports a call inside a .map, .flatMap or .forEach callback, awaited or not", () => {
    for (const method of ["map", "flatMap", "forEach"]) {
      expect(runRule(sqlInLoop, callOn(member(identifier("ids"), method), arrow(awaited(d1Call("queryOne")))))).toEqual([
        message("queryOne", "of a per-item callback"),
      ]);
    }
    expect(runRule(sqlInLoop, callOn(member(identifier("ids"), "map"), arrow(d1Call("query"))))).toEqual([
      message("query", "of a per-item callback"),
    ]);
  });

  it("stops at a function that is not a per-item callback, even inside a loop", () => {
    const helper = callOn(member(identifier("ids"), "filter"), arrow(awaited(d1Call("query"))));
    expect(runRule(sqlInLoop, loop("ForOfStatement", { body: other("BlockStatement", helper) }))).toEqual([]);
  });

  it("leaves batch, other methods and a bare call alone", () => {
    const body = other("BlockStatement", awaited(d1Call("batch")), awaited(d1Call("get")), awaited(callOn(identifier("query"))));
    expect(runRule(sqlInLoop, loop("ForOfStatement", { body }))).toEqual([]);
  });

  it("accepts a call outside any loop", () => {
    expect(runRule(sqlInLoop, other("Program", awaited(d1Call("query"))))).toEqual([]);
  });
});
