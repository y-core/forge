import { describe, expect, it } from "bun:test";

import { type ClassText, classExpressionVisitor, classLiteralVisitor } from "./ast.ts";
import { attribute, call, element, literal, other, property, template, traverse } from "./test-support.ts";
import type { AstNode } from "./types.ts";

function literals(root: AstNode): string[] {
  const found: ClassText[] = [];
  traverse(
    classLiteralVisitor((one) => found.push(one)),
    root,
  );
  return found.map((one) => one.text);
}

function expressions(root: AstNode): string[] {
  const found: ClassText[] = [];
  traverse(
    classExpressionVisitor((one) => found.push(one)),
    root,
  );
  return found.map((one) => one.text);
}

describe("classLiteralVisitor()", () => {
  it("reads a quoted `className`", () => {
    expect(literals(attribute("className", literal("p-4 gap-2")))).toEqual(["p-4 gap-2"]);
  });

  it("reads a quoted `class`, which is what SSR markup writes", () => {
    expect(literals(attribute("class", literal("flex")))).toEqual(["flex"]);
  });

  it("reads every argument of `cn`, `cva` and `asClass`", () => {
    expect(literals(call("cn", literal("a"), call("cva", literal("b")), call("asClass", literal("c"))))).toEqual(["a", "b", "c"]);
  });

  it("reads through an intervening expression, so a guarded class is still class text", () => {
    expect(literals(call("cn", other("LogicalExpression", other("Identifier"), literal("gap-2"))))).toEqual(["gap-2"]);
  });

  it("reads one literal per interpolation-delimited template chunk", () => {
    expect(literals(attribute("className", template("p-", "")))).toEqual(["p-", ""]);
  });

  it("leaves a non-string literal alone", () => {
    expect(literals(call("cn", literal(4), literal(true), literal(null)))).toEqual([]);
  });

  it("leaves a string that sits in no class position alone — the false positive the line scanner had", () => {
    expect(literals(other("Program", attribute("title", literal("transition-duration")), call("describe", literal("intro prose"))))).toEqual([]);
  });

  it("reports each literal once when a class position encloses another", () => {
    expect(literals(attribute("className", call("cn", literal("a"), literal("b"))))).toEqual(["a", "b"]);
  });
});

describe("classExpressionVisitor()", () => {
  it("joins every literal one class position contributes", () => {
    expect(expressions(attribute("className", call("cn", literal("motion-safe:animate-spin"), literal("gap-2"))))).toEqual([
      "motion-safe:animate-spin gap-2",
    ]);
  });

  it("fires once for the outermost position, not once per nested call", () => {
    expect(expressions(attribute("className", call("cn", literal("a"), call("cn", literal("b")))))).toEqual(["a b"]);
  });

  it("keeps two sibling class positions apart", () => {
    expect(expressions(element("div", attribute("className", literal("a")), attribute("class", literal("b"))))).toEqual(["a", "b"]);
  });

  it("joins a component prop's literals, so `{ class: cn(…) }` is one expression", () => {
    expect(expressions(property("class", call("cn", literal("motion-safe:animate-spin"), literal("gap-2"))))).toEqual([
      "motion-safe:animate-spin gap-2",
    ]);
  });

  it("fires for no position that contributed no literal", () => {
    expect(expressions(attribute("className", other("Identifier")))).toEqual([]);
  });

  it("reports the first literal's location, which is where the expression starts", () => {
    const first = literal("a");
    const found: ClassText[] = [];
    traverse(
      classExpressionVisitor((one) => found.push(one)),
      call("cn", first, literal("b")),
    );

    expect(found.map((one) => one.loc)).toEqual([first.loc]);
  });
});
