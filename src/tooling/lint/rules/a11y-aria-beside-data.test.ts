import { describe, expect, it } from "bun:test";

import { attribute, element, literal, runRule } from "../test-support.ts";
import { a11yAriaBesideData, PRESENCE_STATES } from "./a11y-aria-beside-data.ts";

describe("a11y-aria-beside-data", () => {
  it("reports every presence hook the contract emits, so none can be written by hand", () => {
    for (const state of PRESENCE_STATES) {
      const found = runRule(a11yAriaBesideData, element("div", attribute(`data-${state}`, literal(""))));

      expect(found).toHaveLength(1);
      expect(found[0]).toContain(`hand-written \`data-${state}\` — emit it through \`stateAttrs\`, beside its \`aria-${state}\``);
    }
  });

  it("leaves a `data-*` attribute the contract does not emit alone", () => {
    expect(runRule(a11yAriaBesideData, element("div", attribute("data-slot", literal("card"))))).toEqual([]);
  });

  it("leaves a variant naming the same state in a class list alone", () => {
    expect(runRule(a11yAriaBesideData, element("div", attribute("class", literal("data-pressed:bg-accent"))))).toEqual([]);
  });
});
