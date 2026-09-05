import { describe, expect, it } from "bun:test";

import { attribute, call, element, literal, runRule } from "../test-support.ts";
import { focusRing } from "./focus-ring.ts";

const classes = (...texts: string[]) => element("div", attribute("class", call("cn", ...texts.map((text) => literal(text)))));

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
});
