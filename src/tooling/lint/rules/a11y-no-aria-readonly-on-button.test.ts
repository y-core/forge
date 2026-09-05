import { describe, expect, it } from "bun:test";

import { attribute, element, literal, runRule } from "../test-support.ts";
import { a11yNoAriaReadonlyOnButton } from "./a11y-no-aria-readonly-on-button.ts";

const readonly = attribute.bind(null, "aria-readonly");

describe("a11y-no-aria-readonly-on-button", () => {
  it("reports `aria-readonly` on a native button", () => {
    expect(runRule(a11yNoAriaReadonlyOnButton, element("button", readonly(literal("true"))))[0]).toContain("`aria-readonly` on `<button>`");
  });

  it("reports it on the forge component too", () => {
    expect(runRule(a11yNoAriaReadonlyOnButton, element("Button", readonly(literal("true"))))).toHaveLength(1);
  });

  it("reports it on an element that only claims the role", () => {
    const node = element("div", attribute("role", literal("button")), readonly(literal("true")));

    expect(runRule(a11yNoAriaReadonlyOnButton, node)).toHaveLength(1);
  });

  it("leaves `aria-readonly` on a control that supports it alone", () => {
    expect(runRule(a11yNoAriaReadonlyOnButton, element("input", readonly(literal("true"))))).toEqual([]);
  });

  it("leaves a button carrying no `aria-readonly` alone", () => {
    expect(runRule(a11yNoAriaReadonlyOnButton, element("button", attribute("disabled")))).toEqual([]);
  });
});
