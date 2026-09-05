import { describe, expect, it } from "bun:test";

import { attribute, element, literal, runRule } from "../test-support.ts";
import { noInlineStyle } from "./no-inline-style.ts";

describe("no-inline-style", () => {
  it("reports a `style` attribute, whatever value it carries", () => {
    expect(runRule(noInlineStyle, element("div", attribute("style", literal("color:red"))))).toEqual([
      "`style=` attribute — the renderer drops it; express the rule as a class (forge-ui-no-inline-style — src/ui/design/floor.md)",
    ]);
  });

  it("reports one on a component too, which forwards it to an element just the same", () => {
    expect(runRule(noInlineStyle, element("Card", attribute("style", literal("--x:1"))))).toHaveLength(1);
  });

  it("leaves an attribute whose name merely ends in `style` alone", () => {
    expect(runRule(noInlineStyle, element("div", attribute("data-style", literal("x"))))).toEqual([]);
  });

  it("leaves an element carrying no `style` alone", () => {
    expect(runRule(noInlineStyle, element("div", attribute("class", literal("p-4"))))).toEqual([]);
  });
});
