import { describe, expect, it } from "bun:test";

import { attribute, container, element, identifier, literal, runRule } from "../test-support.ts";
import { a11yLivePoliteness } from "./a11y-live-politeness.ts";

const live = (value: Parameters<typeof attribute>[1]) => element("div", attribute("aria-live", value));

describe("a11y-live-politeness", () => {
  it("asks an `assertive` region to state why it interrupts", () => {
    expect(runRule(a11yLivePoliteness, live(literal("assertive")))[0]).toContain('`aria-live="assertive"` interrupts the reader');
  });

  it("reports a value that is neither `polite` nor `assertive`", () => {
    expect(runRule(a11yLivePoliteness, live(literal("off")))[0]).toContain('`aria-live="off"` is neither `polite` nor `assertive`');
  });

  it("leaves `polite` alone — that is the form the rule asks for", () => {
    expect(runRule(a11yLivePoliteness, live(literal("polite")))).toEqual([]);
  });

  it("leaves a value resolved at render time alone, which no reader of the source can judge", () => {
    expect(runRule(a11yLivePoliteness, live(container(identifier("politeness"))))).toEqual([]);
  });

  it("leaves an element carrying no `aria-live` alone", () => {
    expect(runRule(a11yLivePoliteness, element("div", attribute("class", literal("p-4"))))).toEqual([]);
  });
});
