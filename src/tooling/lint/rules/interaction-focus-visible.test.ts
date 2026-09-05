import { describe, expect, it } from "bun:test";

import { attribute, element, literal, runRule } from "../test-support.ts";
import { interactionFocusVisible } from "./interaction-focus-visible.ts";

const classes = (text: string) => element("div", attribute("class", literal(text)));

describe("interaction-focus-visible", () => {
  it("reports a bare `focus:` variant", () => {
    const found = runRule(interactionFocusVisible, classes("focus:ring-2"));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`focus:ring-2` styles every focus including pointer focus");
  });

  it("reports each distinct variant once", () => {
    expect(runRule(interactionFocusVisible, classes("focus:ring-2 focus:ring-2 focus:outline-none"))).toHaveLength(2);
  });

  it("leaves `focus-visible:` alone — that is the form the rule asks for", () => {
    expect(runRule(interactionFocusVisible, classes("focus-visible:ring-2"))).toEqual([]);
  });

  it("leaves `group-focus:` and `focus-within:` alone, neither of which is the bare variant", () => {
    expect(runRule(interactionFocusVisible, classes("group-focus:ring-2 focus-within:ring-2"))).toEqual([]);
  });
});
