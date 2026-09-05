import { describe, expect, it } from "bun:test";

import { attributeNamed, containsTag, enclosingElement, openingTag, spreadName, statedString, tagName } from "./jsx.ts";
import { attribute, container, element, identifier, jsxElement, literal, memberElement, other, runRule, spread } from "./test-support.ts";
import type { AstNode, LintRule } from "./types.ts";

/** Runs `read` over every node of `root`, which is how a rule reaches the helpers. */
function readAt(root: AstNode, type: string, read: (node: AstNode) => string): string[] {
  const rule: LintRule = { create: (context) => ({ [type]: (node) => context.report({ message: read(node), loc: node.loc }) }) };
  return runRule(rule, root);
}

describe("tagName()", () => {
  it("spells a plain tag", () => {
    expect(openingTag(element("div"))).toBe("div");
  });

  it("spells a dotted tag as it is written", () => {
    expect(openingTag(memberElement("Card", "Content"))).toBe("Card.Content");
  });

  it("names an element it cannot spell rather than returning nothing", () => {
    expect(tagName(undefined)).toBe("element");
  });
});

describe("attributeNamed()", () => {
  it("finds an attribute by its exact name", () => {
    expect(attributeNamed(element("div", attribute("class", literal("p-4"))), "class")).toBeDefined();
  });

  it("returns nothing for an attribute the element does not carry", () => {
    expect(attributeNamed(element("div", attribute("class", literal("p-4"))), "style")).toBeUndefined();
  });

  it("looks past a spread, which names no attribute", () => {
    expect(attributeNamed(element("div", spread("rest"), attribute("id", literal("x"))), "id")).toBeDefined();
  });
});

describe("statedString()", () => {
  it("reads a quoted value", () => {
    expect(statedString(literal("polite"))).toBe("polite");
  });

  it("reads one written in an expression container", () => {
    expect(statedString(container(literal("polite")))).toBe("polite");
  });

  it("reads nothing from a value resolved at render time", () => {
    expect(statedString(container(identifier("politeness")))).toBeUndefined();
  });

  it("reads nothing from an absent value, which is a bare boolean attribute", () => {
    expect(statedString(null)).toBeUndefined();
  });
});

describe("spreadName()", () => {
  it("names the bare identifier a spread carries", () => {
    expect(spreadName(spread("rest"))).toBe("rest");
  });

  it("names nothing for a computed spread, which no caller token can hide inside", () => {
    expect(spreadName(other("JSXSpreadAttribute", literal("x")))).toBeUndefined();
  });
});

describe("enclosingElement()", () => {
  it("reaches the element an opening tag belongs to, once the walk has linked it", () => {
    const opening = element("label");

    expect(readAt(jsxElement(opening, literal("Name")), "JSXOpeningElement", (node) => String(enclosingElement(node)?.type))).toEqual([
      "JSXElement",
    ]);
  });

  it("reaches nothing from an opening tag the walk never linked", () => {
    expect(enclosingElement(element("label"))).toBeUndefined();
  });
});

describe("containsTag()", () => {
  const holds = (root: AstNode, tag: string): boolean => containsTag(root, (found) => found === tag);

  it("finds a tag nested any depth down", () => {
    expect(holds(jsxElement(element("div"), jsxElement(element("section"), jsxElement(element("Card")))), "Card")).toBe(true);
  });

  it("finds one rendered from an expression container", () => {
    expect(holds(jsxElement(element("div"), other("JSXExpressionContainer", jsxElement(element("Card")))), "Card")).toBe(true);
  });

  it("does not count the element's own opening tag as inside it", () => {
    expect(holds(jsxElement(element("Card"), literal("x")), "Card")).toBe(false);
  });

  it("finds nothing in an element holding no such tag", () => {
    expect(holds(jsxElement(element("div"), literal("x")), "Card")).toBe(false);
  });
});
