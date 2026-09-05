import { describe, expect, it } from "bun:test";

import { attribute, container, element, literal, memberElement, other, runRule, spread } from "../test-support.ts";
import { dataSlotBeforeSpread } from "./data-slot-before-spread.ts";

const DETAIL =
  '`<div>` has a literal `data-slot=\'card-header\'` before `{...rest}` — the spread wins and the token is lost; destructure `"data-slot": inherited` and write `data-slot={slotToken("card-header", inherited)}`';

describe("data-slot-before-spread", () => {
  it("reports a literal `data-slot` a later spread overwrites", () => {
    expect(runRule(dataSlotBeforeSpread, element("div", attribute("data-slot", literal("card-header")), spread("rest")))).toEqual([DETAIL]);
  });

  it("names a dotted tag as it is written", () => {
    const node = memberElement("Menu", "Item", attribute("data-slot", literal("row")), spread("rest"));

    expect(runRule(dataSlotBeforeSpread, node)[0]).toContain("`<Menu.Item>`");
  });

  it("reads a slot written in an expression container, which the spread clobbers just the same", () => {
    const value = container(literal("row"));

    expect(runRule(dataSlotBeforeSpread, element("div", attribute("data-slot", value), spread("rest")))).toHaveLength(1);
  });

  it("reports once, however many spreads follow", () => {
    const node = element("div", attribute("data-slot", literal("card-header")), spread("rest"), spread("more"));

    expect(runRule(dataSlotBeforeSpread, node)).toHaveLength(1);
  });

  it("leaves a spread written before the slot alone — there the slot wins", () => {
    expect(runRule(dataSlotBeforeSpread, element("div", spread("rest"), attribute("data-slot", literal("card-header"))))).toEqual([]);
  });

  it("leaves an element carrying no spread alone", () => {
    expect(runRule(dataSlotBeforeSpread, element("div", attribute("data-slot", literal("card-header"))))).toEqual([]);
  });

  it("leaves an element carrying no `data-slot` alone", () => {
    expect(runRule(dataSlotBeforeSpread, element("div", attribute("class", literal("p-4")), spread("rest")))).toEqual([]);
  });

  it("leaves a computed `data-slot` alone — `slotToken` is the merge the rule asks for", () => {
    const merged = container(other("CallExpression", literal("card-header")));

    expect(runRule(dataSlotBeforeSpread, element("div", attribute("data-slot", merged), spread("rest")))).toEqual([]);
  });

  it("leaves a spread of an expression alone — only a bare identifier clobbers wholesale", () => {
    const wholesale = other("JSXSpreadAttribute", literal("x"));

    expect(runRule(dataSlotBeforeSpread, element("div", attribute("data-slot", literal("card-header")), wholesale))).toEqual([]);
  });
});
