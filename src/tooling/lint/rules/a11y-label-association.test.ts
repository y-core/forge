import { describe, expect, it } from "bun:test";

import { attribute, element, jsxElement, literal, runRule } from "../test-support.ts";
import { a11yLabelAssociation } from "./a11y-label-association.ts";

describe("a11y-label-association", () => {
  it("reports a `<label>` with neither a `for` nor a wrapped control", () => {
    const found = runRule(a11yLabelAssociation, jsxElement(element("label"), literal("Name")));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("`<label>` with neither a `for` nor a wrapped control");
  });

  it("reports a self-closing `<label>`, which has no body to wrap a control in", () => {
    expect(runRule(a11yLabelAssociation, element("label"))).toHaveLength(1);
  });

  it("leaves a `for` alone, in either spelling", () => {
    for (const name of ["for", "htmlFor"]) {
      expect(runRule(a11yLabelAssociation, jsxElement(element("label", attribute(name, literal("email")))))).toEqual([]);
    }
  });

  it("leaves a wrapped native control alone", () => {
    expect(runRule(a11yLabelAssociation, jsxElement(element("label"), jsxElement(element("input"))))).toEqual([]);
  });

  it("leaves a wrapped forge control alone", () => {
    expect(runRule(a11yLabelAssociation, jsxElement(element("label"), jsxElement(element("Switch"))))).toEqual([]);
  });

  it("leaves an element that is no label alone", () => {
    expect(runRule(a11yLabelAssociation, jsxElement(element("span"), literal("Name")))).toEqual([]);
  });
});
