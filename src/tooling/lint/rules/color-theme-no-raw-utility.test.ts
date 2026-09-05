import { describe, expect, it } from "bun:test";

import { attribute, call, element, literal, runRule } from "../test-support.ts";
import { colorThemeNoRawUtility } from "./color-theme-no-raw-utility.ts";

const classes = (...texts: string[]) => element("div", attribute("class", call("cn", ...texts.map((text) => literal(text)))));

describe("color-theme-no-raw-utility", () => {
  it("reports a raw palette utility with no `dark:` counterpart", () => {
    const found = runRule(colorThemeNoRawUtility, classes("bg-red-500"));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`bg-red-500` has no `dark:bg-red-*` counterpart beside it");
  });

  it("reads the pair across two arguments of one `cn()`, which forge splits a class list over", () => {
    expect(runRule(colorThemeNoRawUtility, classes("bg-red-500", "dark:bg-red-300"))).toEqual([]);
  });

  it("reports each family once, however many utilities of it a list names", () => {
    expect(runRule(colorThemeNoRawUtility, classes("bg-red-500 bg-red-700 text-blue-600"))).toHaveLength(2);
  });

  it("counts the pair per family, so one paired family does not excuse another", () => {
    expect(runRule(colorThemeNoRawUtility, classes("bg-red-500 dark:bg-red-300 text-blue-600"))).toHaveLength(1);
  });

  it("leaves a theme token alone — that is the form the rule asks for", () => {
    expect(runRule(colorThemeNoRawUtility, classes("bg-surface text-foreground"))).toEqual([]);
  });

  it("leaves a palette word that names no shade alone", () => {
    expect(runRule(colorThemeNoRawUtility, classes("bg-red"))).toEqual([]);
  });
});
