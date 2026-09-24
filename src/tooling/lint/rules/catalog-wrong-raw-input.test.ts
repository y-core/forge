import { describe, expect, it } from "bun:test";

import { attribute, container, element, literal, runRule } from "../lint.fixture.ts";
import { catalogWrongRawInput } from "./catalog-wrong-raw-input.ts";

describe("catalog-wrong-raw-input", () => {
  it("reports each raw control the corpus points a component at", () => {
    for (const tag of ["select", "input", "textarea", "button"]) {
      const found = runRule(catalogWrongRawInput, element(tag));

      expect(found).toHaveLength(1);
      expect(found[0]).toContain(`raw \`<${tag}>\` in composed markup`);
    }
  });

  it("leaves a hidden input alone, quoted or in an expression container", () => {
    expect(runRule(catalogWrongRawInput, element("input", attribute("type", literal("hidden"))))).toEqual([]);
    expect(runRule(catalogWrongRawInput, element("input", attribute("type", container(literal("hidden")))))).toEqual([]);
  });

  it("reports an input of any visible type", () => {
    for (const type of ["text", "checkbox"]) {
      const found = runRule(catalogWrongRawInput, element("input", attribute("type", literal(type))));

      expect(found).toHaveLength(1);
      expect(found[0]).toContain("raw `<input>` in composed markup");
    }
  });

  it("leaves the component that wraps the control alone", () => {
    expect(runRule(catalogWrongRawInput, element("Input"))).toEqual([]);
  });

  it("leaves an element that is no control alone", () => {
    expect(runRule(catalogWrongRawInput, element("div"))).toEqual([]);
  });
});
