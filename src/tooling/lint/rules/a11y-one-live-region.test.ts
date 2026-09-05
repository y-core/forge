import { describe, expect, it } from "bun:test";

import { attribute, container, element, identifier, literal, runRule } from "../test-support.ts";
import { a11yOneLiveRegion } from "./a11y-one-live-region.ts";

const live = (value: Parameters<typeof attribute>[1]) => element("div", attribute("aria-live", value));

describe("a11y-one-live-region", () => {
  it("reports a second live region, whatever politeness it claims", () => {
    for (const value of ["polite", "assertive"]) {
      expect(runRule(a11yOneLiveRegion, live(literal(value)))[0]).toContain(`\`aria-live="${value}"\` opens a second live region`);
    }
  });

  it("leaves `off` alone — it announces nothing, so it opens no region", () => {
    expect(runRule(a11yOneLiveRegion, live(literal("off")))).toEqual([]);
  });

  it("leaves a value resolved at render time alone", () => {
    expect(runRule(a11yOneLiveRegion, live(container(identifier("politeness"))))).toEqual([]);
  });

  it("leaves an element carrying no `aria-live` alone", () => {
    expect(runRule(a11yOneLiveRegion, element("div"))).toEqual([]);
  });
});
