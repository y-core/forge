import { describe, expect, it } from "bun:test";

import { call, callOn, declaration, declarator, identifier, literal, logical, member, other, runRule } from "../test-support.ts";
import type { AstNode } from "../types.ts";
import { exactMarkupAssertion } from "./exact-markup-assertion.ts";

/** `expect(subject).<matcher>(…)`, or `expect(subject).not.<matcher>(…)`. */
function assertion(subject: AstNode, matcher: string, negated = false): AstNode {
  const asserted = callOn(identifier("expect"), subject);
  return callOn(member(negated ? member(asserted, "not") : asserted, matcher), literal("x"));
}

/** A `receiver.includes(…)`, whose result a test may assert with `toBe(false)`. */
const includes = (receiver: AstNode): AstNode => callOn(member(receiver, "includes"), literal("x"));

/** A module whose statements the rule walks in order, ending at `Program:exit`. */
const program = (...statements: AstNode[]): AstNode => other("Program", ...statements);

/** `const out = render("<b />")` — the seed every trace starts from. */
const rendered = (): AstNode => declaration(declarator("out", call("render", literal("<b />"))));

/** `out.split(" ")` — a list, whose `toContain` is exact membership rather than a substring. */
const split = (): AstNode => callOn(member(identifier("out"), "split"), literal(" "));

describe("exact-markup-assertion", () => {
  it("reports `toContain` on a binding holding a render", () => {
    const found = runRule(exactMarkupAssertion, program(rendered(), assertion(identifier("out"), "toContain")));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`toContain` on rendered markup");
  });

  it("reports `toMatch` the same way", () => {
    expect(runRule(exactMarkupAssertion, program(rendered(), assertion(identifier("out"), "toMatch")))).toHaveLength(1);
  });

  it("reports through `.not`, which no matcher-name scan alone would reach", () => {
    expect(runRule(exactMarkupAssertion, program(rendered(), assertion(identifier("out"), "toContain", true)))).toHaveLength(1);
  });

  it("reports a `.includes` on markup, which no `.not.toContain` scan would see", () => {
    const found = runRule(exactMarkupAssertion, program(rendered(), includes(identifier("out"))));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`.includes` on rendered markup");
  });

  it("reports a render called inline, with no binding to trace", () => {
    expect(runRule(exactMarkupAssertion, program(assertion(call("render", literal("<b />")), "toContain")))).toHaveLength(1);
  });

  it("traces a local wrapper one call deep", () => {
    const wrapper = declaration(declarator("page", other("ArrowFunctionExpression", call("render", literal("<b />")))));
    const bound = declaration(declarator("out", call("page")));

    expect(runRule(exactMarkupAssertion, program(wrapper, bound, assertion(identifier("out"), "toContain")))).toHaveLength(1);
  });

  it("traces a wrapper declared after the one it calls, which one pass would miss", () => {
    const outer = declaration(declarator("body", other("ArrowFunctionExpression", call("page"))));
    const inner = declaration(declarator("page", other("ArrowFunctionExpression", call("renderPage", literal("<b />")))));
    const bound = declaration(declarator("out", call("body")));

    expect(runRule(exactMarkupAssertion, program(outer, inner, bound, assertion(identifier("out"), "toContain")))).toHaveLength(1);
  });

  it("leaves a `toContain` on a list alone — there it is exact membership, not a substring", () => {
    const list = declaration(declarator("classes", split()));

    expect(runRule(exactMarkupAssertion, program(rendered(), list, assertion(identifier("classes"), "toContain")))).toEqual([]);
  });

  it("leaves a list built with a `?? []` fallback alone, whose outermost node is not the split", () => {
    const list = declaration(declarator("classes", logical(split(), other("ArrayExpression"))));

    expect(runRule(exactMarkupAssertion, program(rendered(), list, assertion(identifier("classes"), "toContain")))).toEqual([]);
  });

  it("leaves a `toContain` on a value no renderer reaches alone", () => {
    const plain = declaration(declarator("label", literal("Save")));

    expect(runRule(exactMarkupAssertion, program(plain, assertion(identifier("label"), "toContain")))).toEqual([]);
  });

  it("leaves an exact matcher on markup alone — that is the form the rule asks for", () => {
    expect(runRule(exactMarkupAssertion, program(rendered(), assertion(identifier("out"), "toBe")))).toEqual([]);
  });
});
