import { describe, expect, it } from "bun:test";

import { childrenOf } from "../ast.ts";
import {
  call,
  callOn,
  declaration,
  declarator,
  fnDeclaration,
  identifier,
  literal,
  logical,
  member,
  other,
  returnStatement,
  runRule,
  traverse,
} from "../lint.fixture.ts";
import type { AstNode, RuleContext, RuleScope, ScopeVariable } from "../types.ts";
import { exactMarkupAssertion } from "./exact-markup-assertion.ts";

/** The node types that open a lexical scope in this fake. */
const SCOPE_NODES = new Set(["Program", "BlockStatement", "ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);

/** Links every node's `parent`, including the callees and ids `traverse` never visits. */
function linkParents(node: AstNode): AstNode {
  for (const child of childrenOf(node)) {
    child.parent = node;
    linkParents(child);
  }
  return node;
}

/** The bindings `scope` declares, stopping at any nested scope. */
function declaredIn(scope: AstNode, node: AstNode = scope, set = new Map<string, ScopeVariable>()): Map<string, ScopeVariable> {
  for (const child of childrenOf(node)) {
    const name = (child as unknown as { id?: { name?: unknown } }).id?.name;
    if ((child.type === "VariableDeclarator" || child.type === "FunctionDeclaration") && typeof name === "string") {
      set.set(name, { defs: [{ node: child }] });
    }
    if (!SCOPE_NODES.has(child.type)) declaredIn(scope, child, set);
  }
  return set;
}

/** The scope `node` is read in, modelled on oxlint's scope manager. */
function scopeOf(node: AstNode | null | undefined): RuleScope | null {
  if (node == null) return null;
  if (!SCOPE_NODES.has(node.type)) return scopeOf(node.parent);
  return { upper: scopeOf(node.parent), set: declaredIn(node) };
}

/** Every report the rule makes over `root`, with the line it was made at. */
function lint(root: AstNode): { message: string; line: number | undefined }[] {
  const found: { message: string; line: number | undefined }[] = [];
  const context: RuleContext = {
    report: ({ message, loc }) => found.push({ message, line: loc?.start.line }),
    sourceCode: { getDisableDirectives: () => ({ directives: [] }), getScope: (node) => scopeOf(node) ?? { upper: null, set: new Map() } },
  };
  traverse(exactMarkupAssertion.create(context), linkParents(root));
  return found;
}

/** `it("case", () => { …statements })`, whose body is a scope of its own. */
const testCase = (...statements: AstNode[]): AstNode =>
  callOn(identifier("it"), literal("case"), other("ArrowFunctionExpression", other("BlockStatement", ...statements)));

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
    const found = lint(program(rendered(), assertion(identifier("out"), "toContain")));

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("`toContain` on rendered markup");
  });

  it("reports `toMatch` the same way", () => {
    expect(lint(program(rendered(), assertion(identifier("out"), "toMatch")))).toHaveLength(1);
  });

  it("leaves a `.not.toContain` alone — absence is the one thing no exact match can state", () => {
    expect(lint(program(rendered(), assertion(identifier("out"), "toContain", true)))).toEqual([]);
  });

  it("leaves a `.not.toMatch` alone for the same reason", () => {
    expect(lint(program(rendered(), assertion(identifier("out"), "toMatch", true)))).toEqual([]);
  });

  it("reports a `.includes` on markup, which no `.not.toContain` scan would see", () => {
    const found = lint(program(rendered(), includes(identifier("out"))));

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("`.includes` on rendered markup");
  });

  it("leaves an `.includes` asserted `toBe(false)` alone — the same absence claim, differently spelled", () => {
    const absence = callOn(member(callOn(identifier("expect"), includes(identifier("out"))), "toBe"), literal(false));

    expect(lint(program(rendered(), absence))).toEqual([]);
  });

  it("leaves an `.includes` asserted `not.toBe(true)` alone, which is the same claim negated twice", () => {
    const expected = callOn(identifier("expect"), includes(identifier("out")));
    const absence = callOn(member(member(expected, "not"), "toBe"), literal(true));

    expect(lint(program(rendered(), absence))).toEqual([]);
  });

  it("still reports an `.includes` asserted `toBe(true)`, which claims presence somewhere unpinned", () => {
    const presence = callOn(member(callOn(identifier("expect"), includes(identifier("out"))), "toBe"), literal(true));

    expect(lint(program(rendered(), presence))).toHaveLength(1);
  });

  it("reports a render called inline, with no binding to trace", () => {
    expect(lint(program(assertion(call("render", literal("<b />")), "toContain")))).toHaveLength(1);
  });

  it("traces a local wrapper one call deep", () => {
    const wrapper = declaration(declarator("page", other("ArrowFunctionExpression", call("render", literal("<b />")))));
    const bound = declaration(declarator("out", call("page")));

    expect(lint(program(wrapper, bound, assertion(identifier("out"), "toContain")))).toHaveLength(1);
  });

  it("traces a wrapper declared after the one it calls, which one pass would miss", () => {
    const outer = declaration(declarator("body", other("ArrowFunctionExpression", call("page"))));
    const inner = declaration(declarator("page", other("ArrowFunctionExpression", call("renderPage", literal("<b />")))));
    const bound = declaration(declarator("out", call("body")));

    expect(lint(program(outer, inner, bound, assertion(identifier("out"), "toContain")))).toHaveLength(1);
  });

  it("leaves a `toContain` on a list alone — there it is exact membership, not a substring", () => {
    const list = declaration(declarator("classes", split()));

    expect(lint(program(rendered(), list, assertion(identifier("classes"), "toContain")))).toEqual([]);
  });

  it("leaves a list built with a `?? []` fallback alone, whose outermost node is not the split", () => {
    const list = declaration(declarator("classes", logical(split(), other("ArrayExpression"))));

    expect(lint(program(rendered(), list, assertion(identifier("classes"), "toContain")))).toEqual([]);
  });

  it("leaves a `toContain` on a call to a helper declared to return an array alone", () => {
    const helper = fnDeclaration("sectionIds", other("BlockStatement"), other("TSTypeAnnotation", other("TSArrayType")));

    expect(lint(program(helper, assertion(call("sectionIds", call("render", literal("<b />"))), "toContain")))).toEqual([]);
  });

  it("leaves a `toContain` on a helper whose body returns a list alone, with no annotation to read", () => {
    const helper = fnDeclaration("sectionIds", other("BlockStatement", returnStatement(split())));

    expect(lint(program(rendered(), helper, assertion(call("sectionIds", identifier("out")), "toContain")))).toEqual([]);
  });

  it("leaves a `toContain` on an imported fixture helper known by name to return a list alone", () => {
    expect(lint(program(rendered(), assertion(call("classesOf", identifier("out")), "toContain")))).toEqual([]);
  });

  it("still reports a helper that returns markup rather than a list", () => {
    const helper = fnDeclaration("section", other("BlockStatement", returnStatement(call("render", literal("<b />")))));

    expect(lint(program(helper, assertion(call("section"), "toContain")))).toHaveLength(1);
  });

  it("leaves a `toContain` on a value no renderer reaches alone", () => {
    const plain = declaration(declarator("label", literal("Save")));

    expect(lint(program(plain, assertion(identifier("label"), "toContain")))).toEqual([]);
  });

  it("leaves an exact matcher on markup alone — that is the form the rule asks for", () => {
    expect(lint(program(rendered(), assertion(identifier("out"), "toBe")))).toEqual([]);
  });

  it("reports only the assertion on its own case's markup binding, not a same-named plain value in another case", () => {
    const markup = assertion(identifier("before"), "toContain");
    const marked = testCase(declaration(declarator("before", call("render", literal("<b />")))), markup);
    const plain = testCase(declaration(declarator("before", literal("Save"))), assertion(identifier("before"), "toContain"));

    expect(lint(program(marked, plain)).map((f) => f.line)).toEqual([markup.loc.start.line]);
  });

  it("reports only the assertion on its own case's markup binding the same when the plain case comes first", () => {
    const markup = assertion(identifier("before"), "toContain");
    const marked = testCase(declaration(declarator("before", call("render", literal("<b />")))), markup);
    const plain = testCase(declaration(declarator("before", literal("Save"))), assertion(identifier("before"), "toContain"));

    expect(lint(program(plain, marked)).map((f) => f.line)).toEqual([markup.loc.start.line]);
  });

  it("reports an outer render read from a case that declares no binding of its own", () => {
    const markup = assertion(identifier("out"), "toContain");

    expect(lint(program(rendered(), testCase(markup))).map((f) => f.line)).toEqual([markup.loc.start.line]);
  });

  it("leaves an inner plain binding alone where it shadows an outer render", () => {
    const shadowed = testCase(declaration(declarator("out", literal("Save"))), assertion(identifier("out"), "toContain"));

    expect(lint(program(rendered(), shadowed))).toEqual([]);
  });

  it("judges list-ness per declaration, so a same-named list elsewhere does not hide markup", () => {
    const markup = assertion(identifier("classes"), "toContain");
    const listed = testCase(declaration(declarator("classes", split())), assertion(identifier("classes"), "toContain"));
    const marked = testCase(declaration(declarator("classes", identifier("out"))), markup);

    expect(lint(program(rendered(), listed, marked)).map((f) => f.line)).toEqual([markup.loc.start.line]);
  });

  it("leaves a name no scope declares alone, though a same-named binding in another case holds markup", () => {
    const markup = assertion(identifier("before"), "toContain");
    const marked = testCase(declaration(declarator("before", call("render", literal("<b />")))), markup);
    const undeclared = testCase(assertion(identifier("before"), "toContain"));

    expect(lint(program(marked, undeclared)).map((f) => f.line)).toEqual([markup.loc.start.line]);
  });

  it("still reports an inline render when the host offers no scope manager", () => {
    const found = runRule(exactMarkupAssertion, program(assertion(call("render", literal("<b />")), "toContain")));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`toContain` on rendered markup");
  });
});
