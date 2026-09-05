import { describe, expect, it } from "bun:test";

import { element, jsxElement, literal, memberElement, other, runRule } from "../test-support.ts";
import { noNestedCard } from "./no-nested-card.ts";

const content = (...children: Parameters<typeof jsxElement>[1][]) => jsxElement(memberElement("Card", "Content"), ...children);

describe("no-nested-card", () => {
  it("reports a `<Card>` opened inside a `<Card.Content>`", () => {
    const found = runRule(noNestedCard, content(jsxElement(element("Card"), literal("x"))));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`<Card>` nested inside `<Card.Content>`");
  });

  it("reaches a card nested several elements deep", () => {
    const inner = jsxElement(element("div"), jsxElement(element("section"), jsxElement(element("Card"))));

    expect(runRule(noNestedCard, content(inner))).toHaveLength(1);
  });

  it("reaches a card rendered from an expression container, which a tag scan would read as text", () => {
    expect(runRule(noNestedCard, content(other("JSXExpressionContainer", jsxElement(element("Card")))))).toHaveLength(1);
  });

  it("leaves a `<Card.Content>` holding no card alone", () => {
    expect(runRule(noNestedCard, content(jsxElement(element("p"), literal("x"))))).toEqual([]);
  });

  it("leaves a `<Card.Header>` beside a card alone — only content nests", () => {
    expect(runRule(noNestedCard, jsxElement(memberElement("Card", "Header"), jsxElement(element("Card"))))).toEqual([]);
  });

  it("leaves the `<Card.Content>` element's own tag out of its body", () => {
    expect(runRule(noNestedCard, content())).toEqual([]);
  });
});
