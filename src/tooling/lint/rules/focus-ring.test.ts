import { describe, expect, it } from "bun:test";

import { attribute, call, container, declaration, declarator, element, identifier, literal, other, runRule } from "../lint.fixture.ts";
import type { AstNode } from "../types.ts";
import { focusRing } from "./focus-ring.ts";

const classes = (...texts: string[]) => element("div", attribute("class", call("cn", ...texts.map((text) => literal(text)))));

const concatenation = (...parts: string[]): AstNode =>
  parts.map((part) => literal(part)).reduce((left, right) => other("BinaryExpression", left, right));

const menuItemClass = (cursorAndOutline: string): AstNode =>
  concatenation(
    "flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start text-sm text-popover-foreground ",
    `bg-transparent border-0 ${cursorAndOutline} `,
    "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground ",
    "state-disabled",
  );

const exported = (init: AstNode, ...rest: AstNode[]): AstNode =>
  other("Program", other("ExportNamedDeclaration", declaration(declarator("MENU_ITEM_CLASS", init))), ...rest);

describe("focus-ring", () => {
  it("reports a suppressed outline on a pointer target with no ring in its place", () => {
    const found = runRule(focusRing, classes("cursor-pointer outline-none"));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`outline-none` on a pointer target with no `focus-visible:ring-*` beside it");
  });

  it("reports `outline-hidden` the same way", () => {
    expect(runRule(focusRing, classes("cursor-pointer outline-hidden"))).toHaveLength(1);
  });

  it("leaves a replaced outline alone, whichever spelling of the ring puts it back", () => {
    for (const ring of ["focus-visible:ring-2", "focus-ring", "focus-ring-outset"]) {
      expect(runRule(focusRing, classes("cursor-pointer outline-none", ring))).toEqual([]);
    }
  });

  it("reports a `ring-0` or a bare `ring-offset`, neither of which draws an affordance", () => {
    expect(runRule(focusRing, classes("cursor-pointer outline-none focus-visible:ring-0"))).toHaveLength(1);
    expect(runRule(focusRing, classes("cursor-pointer outline-none focus-visible:ring-offset-2"))).toHaveLength(1);
  });

  it("leaves a surface alone — nothing focuses it, so it owes no ring", () => {
    expect(runRule(focusRing, classes("outline-none rounded-lg"))).toEqual([]);
  });

  it("reports a module-scope `*_CLASS` that suppresses the outline with no ring, though nothing in its file uses it", () => {
    expect(runRule(focusRing, exported(menuItemClass("cursor-pointer outline-none")))).toHaveLength(1);
  });

  it("leaves the same constant alone once the ring replaces the suppressed outline", () => {
    expect(runRule(focusRing, exported(menuItemClass("cursor-pointer focus-ring")))).toEqual([]);
  });

  it("reports the constant once, not again where `cn` names it", () => {
    const used = exported(
      menuItemClass("cursor-pointer outline-none"),
      element("div", attribute("class", container(call("cn", identifier("MENU_ITEM_CLASS"))))),
    );

    expect(runRule(focusRing, used)).toHaveLength(1);
  });
});
