import { describe, expect, it } from "bun:test";

import { childrenOf } from "../ast.ts";
import {
  call,
  callOn,
  declaration,
  declarator,
  fnDeclaration,
  identifier,
  interpolated,
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
function lint(root: AstNode, options?: readonly unknown[]): { message: string; line: number | undefined }[] {
  const found: { message: string; line: number | undefined }[] = [];
  const context: RuleContext = {
    ...(options === undefined ? {} : { options }),
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

/** `{ key: value }`'s one property, written `{ key }` when `shorthand`. */
const property = (key: AstNode, value: AstNode, shorthand = false): AstNode =>
  ({ type: "Property", loc: key.loc, key, value, computed: false, shorthand, children: [value] }) as unknown as AstNode;

/** `const out = render("<b />")` — the seed every trace starts from. */
const rendered = (): AstNode => declaration(declarator("out", call("render", literal("<b />"))));

/** `out.split(" ")` — a list, whose `toContain` is exact membership rather than a substring. */
const split = (): AstNode => callOn(member(identifier("out"), "split"), literal(" "));

/** `[…items]`, whose slots the real AST names `elements`. */
const tuple = (...items: AstNode[]): AstNode =>
  ({ type: "ArrayExpression", loc: items[0]?.loc, elements: items, children: items }) as unknown as AstNode;

/** `{ …properties }`, whose entries the real AST names `properties`. */
const record = (...properties: AstNode[]): AstNode =>
  ({ type: "ObjectExpression", loc: properties[0]?.loc, properties, children: properties }) as unknown as AstNode;

/** `expect(subject).<matcher>(expected)`. */
const equals = (subject: AstNode, expected: AstNode, matcher = "toEqual"): AstNode =>
  callOn(member(callOn(identifier("expect"), subject), matcher), expected);

/** `await argument`, which the real AST names `argument`. */
const awaited = (argument: AstNode): AstNode =>
  ({ type: "AwaitExpression", loc: argument.loc, argument, children: [argument] }) as unknown as AstNode;

/** `const html = await res.text()` — markup read off a response rather than rendered in the test. */
const fetched = (): AstNode => declaration(declarator("html", awaited(callOn(member(identifier("res"), "text")))));

/** An arrow function, whose returned expression or block the real AST names `body`. */
const arrow = (body: AstNode): AstNode => ({ type: "ArrowFunctionExpression", loc: body.loc, body, children: [body] }) as unknown as AstNode;

/** `(…expressions)`, which evaluates every element and yields the last. */
const sequence = (...expressions: AstNode[]): AstNode =>
  ({ type: "SequenceExpression", loc: expressions[0]?.loc, expressions, children: expressions }) as unknown as AstNode;

/** `await res.text()`, the read that makes a response body markup. */
const readBody = (): AstNode => awaited(callOn(member(identifier("res"), "text")));

/** `app.fetch(path)`, the response a seam spec reads its markup off. */
const fetchPage = (): AstNode => callOn(member(identifier("app"), "fetch"), identifier("path"));

/** `<receiver>.text()`, un-awaited — a promise of the markup. */
const text = (receiver: AstNode): AstNode => callOn(member(receiver, "text"));

/** `app.fetch(path).then(<callback>)`. */
const thenOnFetch = (callback: AstNode): AstNode => callOn(member(fetchPage(), "then"), callback);

/** `expect(await <helper>()).toContain(…)` on what a local helper hands back. */
const helperAssertion = (helper: string): AstNode => assertion(awaited(call(helper)), "toContain");

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
    const wrapper = declaration(declarator("page", arrow(call("render", literal("<b />")))));
    const bound = declaration(declarator("out", call("page")));

    expect(lint(program(wrapper, bound, assertion(identifier("out"), "toContain")))).toHaveLength(1);
  });

  it("traces a wrapper declared after the one it calls, which one pass would miss", () => {
    const outer = declaration(declarator("body", arrow(call("page"))));
    const inner = declaration(declarator("page", arrow(call("renderPage", literal("<b />")))));
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

  it("leaves a `toContain` on each plural markup reader alone, whose answer is a list", () => {
    for (const reader of ["tagsOf", "elementsOf", "attrValuesOf"]) {
      expect(lint(program(rendered(), assertion(call(reader, identifier("out")), "toContain")))).toEqual([]);
    }
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

  it("leaves `x.out` alone beside a markup binding named `out` — the property is spelled, not read", () => {
    const read = declaration(declarator("text", member(identifier("x"), "out")));

    expect(lint(program(rendered(), read, assertion(identifier("text"), "toContain")))).toEqual([]);
  });

  it("leaves an object key named like a markup binding alone", () => {
    const keyed = other("ObjectExpression", property(identifier("out"), literal("Save")));

    expect(lint(program(rendered(), assertion(keyed, "toContain")))).toEqual([]);
  });

  it("reports `x[out]`, whose computed property reads the markup binding", () => {
    const computed = { ...member(identifier("x"), "out"), computed: true } as unknown as AstNode;

    expect(lint(program(rendered(), assertion(computed, "toContain")))).toHaveLength(1);
  });

  it("reports a shorthand `{ out }`, whose one node is both key and value", () => {
    const value = identifier("out");
    const shorthand = other("ObjectExpression", property(value, value, true));

    expect(lint(program(rendered(), assertion(shorthand, "toContain")))).toHaveLength(1);
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

  it("reports presence on markup read through an awaited `res.text()`", () => {
    const found = lint(program(fetched(), assertion(identifier("html"), "toContain")));

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("`toContain` on rendered markup");
  });

  describe("under `responseText: false`, as an app's base config sets it", () => {
    const appOptions = [{ responseText: false }];

    it("reports nothing on a `.text()` body, which may be the plain text of a 429", () => {
      const body = assertion(readBody(), "toContain");

      expect(lint(program(fetched(), assertion(identifier("html"), "toContain"), body), appOptions)).toEqual([]);
    });

    it("reports nothing on a helper that returns `(await app.fetch(path)).text()`", () => {
      const helper = declaration(declarator("page", arrow(text(awaited(fetchPage())))));

      expect(lint(program(helper, helperAssertion("page")), appOptions)).toEqual([]);
    });

    it("still reports a renderer's output, which is markup whatever tree it is in", () => {
      expect(lint(program(assertion(call("render", literal("<b />")), "toContain")), appOptions)).toHaveLength(1);
    });
  });

  it("reports an `.includes` on fetched markup asserted `toBe(true)`", () => {
    const presence = callOn(member(callOn(identifier("expect"), includes(identifier("html"))), "toBe"), literal(true));

    expect(lint(program(fetched(), presence))).toHaveLength(1);
  });

  it('reports `expect(html.includes("<p>")).toBe(true)` on rendered markup', () => {
    const presence = callOn(
      member(callOn(identifier("expect"), callOn(member(identifier("out"), "includes"), literal("<p>"))), "toBe"),
      literal(true),
    );

    expect(lint(program(rendered(), presence))).toHaveLength(1);
  });

  it("leaves `expect(body).not.toContain(secret)` on fetched markup alone", () => {
    expect(lint(program(fetched(), assertion(identifier("html"), "toContain", true)))).toEqual([]);
  });

  it("reports an `.includes` in a tuple whose `toEqual` slot expects `true`", () => {
    const presence = equals(tuple(identifier("status"), includes(identifier("html"))), tuple(literal(200), literal(true)));

    expect(lint(program(fetched(), presence))).toHaveLength(1);
  });

  it("leaves an `.includes` in a tuple whose `toEqual` slot expects `false` alone", () => {
    const absence = equals(tuple(identifier("status"), includes(identifier("html"))), tuple(literal(200), literal(false)));

    expect(lint(program(fetched(), absence))).toEqual([]);
  });

  it("reads the slot by position, so a `false` elsewhere in the tuple exempts nothing", () => {
    const presence = equals(tuple(includes(identifier("html")), identifier("missing")), tuple(literal(true), literal(false)));

    expect(lint(program(fetched(), presence))).toHaveLength(1);
  });

  it("leaves an `.includes` in a record whose `toStrictEqual` key expects `false` alone", () => {
    const subject = record(property(identifier("status"), identifier("status")), property(identifier("notice"), includes(identifier("html"))));
    const expected = record(property(identifier("notice"), literal(false)), property(identifier("status"), literal(200)));

    expect(lint(program(fetched(), equals(subject, expected, "toStrictEqual")))).toEqual([]);
  });

  it("reports an `.includes` in a record whose `toEqual` key expects `true`", () => {
    const subject = record(property(identifier("notice"), includes(identifier("html"))));

    expect(lint(program(fetched(), equals(subject, record(property(identifier("notice"), literal(true))))))).toHaveLength(1);
  });

  it("leaves a helper alone that reads the body and returns the status as a sequence's last element", () => {
    const helper = declaration(declarator("status", arrow(sequence(readBody(), member(identifier("res"), "status")))));

    expect(lint(program(helper, helperAssertion("status")))).toEqual([]);
  });

  it("leaves a helper alone whose returned template is not built from the body it reads", () => {
    const body = declaration(declarator("body", readBody()));
    const label = returnStatement(interpolated(["status ", ""], [member(identifier("res"), "status")]));
    const helper = declaration(declarator("label", arrow(other("BlockStatement", body, label))));

    expect(lint(program(helper, helperAssertion("label")))).toEqual([]);
  });

  it("leaves a block-bodied helper alone that reads the body and returns `res.status`", () => {
    const block = other("BlockStatement", other("ExpressionStatement", readBody()), returnStatement(member(identifier("res"), "status")));

    expect(lint(program(declaration(declarator("status", arrow(block))), helperAssertion("status")))).toEqual([]);
  });

  it("reports a helper that returns the body it reads", () => {
    const helper = declaration(declarator("page", arrow(readBody())));

    expect(lint(program(helper, helperAssertion("page")))).toHaveLength(1);
  });

  it("reports a helper whose arrow returns `(await app.fetch(path)).text()`", () => {
    const helper = declaration(declarator("page", arrow(text(awaited(fetchPage())))));

    expect(lint(program(helper, helperAssertion("page")))).toHaveLength(1);
  });

  it("reports a helper that returns `app.fetch(path).then((r) => r.text())`", () => {
    const helper = declaration(declarator("page", arrow(thenOnFetch(arrow(text(identifier("r")))))));

    expect(lint(program(helper, helperAssertion("page")))).toHaveLength(1);
  });

  it("reports an async helper whose `return res.text()` is left for the caller to await", () => {
    const response = declaration(declarator("res", awaited(fetchPage())));
    const helper = fnDeclaration("page", other("BlockStatement", response, returnStatement(text(identifier("res")))));

    expect(lint(program(helper, helperAssertion("page")))).toHaveLength(1);
  });

  it("leaves a helper alone that calls `res.text()` un-awaited and returns `res.status`", () => {
    const block = other(
      "BlockStatement",
      other("ExpressionStatement", text(identifier("res"))),
      returnStatement(member(identifier("res"), "status")),
    );

    expect(lint(program(declaration(declarator("status", arrow(block))), helperAssertion("status")))).toEqual([]);
  });

  it("leaves a helper alone whose `.then` callback returns the status rather than the body", () => {
    const helper = declaration(declarator("status", arrow(thenOnFetch(arrow(member(identifier("r"), "status"))))));

    expect(lint(program(helper, helperAssertion("status")))).toEqual([]);
  });

  it("reports a helper whose `.then` is handed a markup helper by name", () => {
    const toText = declaration(declarator("toText", arrow(text(identifier("r")))));
    const page = declaration(declarator("page", arrow(thenOnFetch(identifier("toText")))));

    expect(lint(program(toText, page, helperAssertion("page")))).toHaveLength(1);
  });

  it("reports a `.then` handed a markup helper declared after the caller", () => {
    const page = declaration(declarator("page", arrow(thenOnFetch(identifier("toText")))));
    const toText = declaration(declarator("toText", arrow(text(identifier("r")))));

    expect(lint(program(page, toText, helperAssertion("page")))).toHaveLength(1);
  });

  it("reports a `.then` handed a `function` declaration that returns the body", () => {
    const toText = fnDeclaration("toText", other("BlockStatement", returnStatement(text(identifier("r")))));
    const page = declaration(declarator("page", arrow(thenOnFetch(identifier("toText")))));

    expect(lint(program(toText, page, helperAssertion("page")))).toHaveLength(1);
  });

  it("reports a `.then` whose rejection handler is a markup helper passed by name", () => {
    const handler = declaration(declarator("renderError", arrow(call("render", literal("<b />")))));
    const rejected = callOn(member(fetchPage(), "then"), identifier("undefined"), identifier("renderError"));
    const page = declaration(declarator("page", arrow(rejected)));

    expect(lint(program(handler, page, helperAssertion("page")))).toHaveLength(1);
  });

  it('reports `rows.map(renderRow).join("")`, whose joined rows are markup', () => {
    const joined = callOn(member(callOn(member(identifier("rows"), "map"), identifier("renderRow")), "join"), literal(""));

    expect(lint(program(assertion(joined, "toContain")))).toHaveLength(1);
  });

  it("leaves a `.then` handed a helper that returns the status alone", () => {
    const toStatus = declaration(declarator("toStatus", arrow(member(identifier("r"), "status"))));
    const status = declaration(declarator("status", arrow(thenOnFetch(identifier("toStatus")))));

    expect(lint(program(toStatus, status, helperAssertion("status")))).toEqual([]);
  });

  it("leaves `.then(String)` alone on a receiver that is not markup", () => {
    const status = declaration(declarator("status", arrow(thenOnFetch(identifier("String")))));

    expect(lint(program(status, helperAssertion("status")))).toEqual([]);
  });

  it("leaves `expect(rows.map(renderRow)).toContain(x)` alone — the list's membership is exact", () => {
    const mapped = callOn(member(identifier("rows"), "map"), identifier("renderRow"));

    expect(lint(program(assertion(mapped, "toContain")))).toEqual([]);
  });

  it("leaves a `.then` handed a parameter alone, whose callback is the caller's", () => {
    const reader = { ...arrow(thenOnFetch(identifier("read"))), params: [identifier("p"), identifier("read")] } as unknown as AstNode;

    expect(lint(program(declaration(declarator("page", reader)), helperAssertion("page")))).toEqual([]);
  });

  it("still reports an inline render when the host offers no scope manager", () => {
    const found = runRule(exactMarkupAssertion, program(assertion(call("render", literal("<b />")), "toContain")));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`toContain` on rendered markup");
  });
});
