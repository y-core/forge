import { describe, expect, it } from "bun:test";

import { attribute, call, element, literal, other, runRule } from "../test-support.ts";
import { a11yHeadingSizeByClass } from "./a11y-heading-size-by-class.ts";

const CORPUS = "(forge-ui-a11y-heading-size-by-class — src/ui/design/reference/10-accessibility.md)";

describe("a11y-heading-size-by-class", () => {
  it("reports a heading whose class carries no size", () => {
    expect(runRule(a11yHeadingSizeByClass, element("h2", attribute("className", literal("font-bold"))))).toEqual([
      `\`<h2>\` takes its size from the tag — set the size with a \`text-*\` class and the level from the section's position ${CORPUS}`,
    ]);
  });

  it("accepts a heading that sets its size with a `text-*` class", () => {
    expect(runRule(a11yHeadingSizeByClass, element("h3", attribute("className", literal("text-xl font-bold"))))).toEqual([]);
  });

  it("reads the size out of a sibling `cn()` argument — unreachable while the check read one quoted attribute", () => {
    const heading = element("h1", attribute("className", call("cn", literal("font-bold"), literal("text-2xl"))));

    expect(runRule(a11yHeadingSizeByClass, heading)).toEqual([]);
  });

  it("reports a `cn()`-valued class that names no size, which the quoted-attribute scan could not see", () => {
    const heading = element("h1", attribute("className", call("cn", literal("font-bold"), literal("underline"))));

    expect(runRule(a11yHeadingSizeByClass, heading)).toHaveLength(1);
  });

  it("names the tag it found, so the reader knows which heading to fix", () => {
    const found = runRule(a11yHeadingSizeByClass, element("h6", attribute("className", literal("font-bold"))));

    expect(found[0]?.startsWith("`<h6>`")).toBe(true);
  });

  it("leaves a heading with no class position alone — nothing is written to judge", () => {
    expect(runRule(a11yHeadingSizeByClass, element("h2"))).toEqual([]);
  });

  it("leaves every non-heading element alone", () => {
    expect(runRule(a11yHeadingSizeByClass, element("div", attribute("className", literal("font-bold"))))).toEqual([]);
  });

  it("leaves a `cn()` call that is not a class attribute alone", () => {
    expect(runRule(a11yHeadingSizeByClass, other("VariableDeclarator", call("cn", literal("font-bold"))))).toEqual([]);
  });

  it("does not read `text-balance` as a size, whose `text-` prefix is the trap the utility list closes", () => {
    expect(runRule(a11yHeadingSizeByClass, element("h2", attribute("className", literal("text-balance font-bold"))))).toHaveLength(1);
  });
});
