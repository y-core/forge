import { describe, expect, it } from "bun:test";

import { element, jsxElement, literal, memberElement, other, runRule } from "../lint.fixture.ts";
import { interactionFilterGroupRequired } from "./interaction-filter-group-required.ts";

const item = () => jsxElement(memberElement("Filter", "Item"), literal("A"));
const group = (...children: Parameters<typeof jsxElement>[1][]) => jsxElement(memberElement("Filter", "Group"), ...children);
const filter = (...children: Parameters<typeof jsxElement>[1][]) => jsxElement(element("Filter"), ...children);

describe("interaction-filter-group-required", () => {
  it("reports a chip the root holds directly, which renders a radio belonging to nothing named", () => {
    const found = runRule(interactionFilterGroupRequired, filter(item()));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`<Filter.Item>` outside a `<Filter.Group>`");
  });

  it("reports every loose chip, since each is its own unnamed radio", () => {
    expect(runRule(interactionFilterGroupRequired, filter(item(), item()))).toHaveLength(2);
  });

  it("reaches a chip nested under markup of the caller's own, where a direct-child scan would miss it", () => {
    expect(runRule(interactionFilterGroupRequired, filter(jsxElement(element("div"), item())))).toHaveLength(1);
  });

  it("takes the nearest of the two, so a wrapped chip passes however deep the group sits", () => {
    expect(runRule(interactionFilterGroupRequired, filter(group(jsxElement(element("div"), item()))))).toEqual([]);
  });

  it("leaves a chip rendered outside any `Filter` alone — a test fixture names its own group", () => {
    expect(runRule(interactionFilterGroupRequired, other("Program", item()))).toEqual([]);
  });

  it("leaves a `Filter` holding only its reset alone", () => {
    expect(runRule(interactionFilterGroupRequired, filter(jsxElement(memberElement("Filter", "Reset"))))).toEqual([]);
  });
});
