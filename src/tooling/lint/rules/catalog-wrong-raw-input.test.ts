import { describe, expect, it } from "bun:test";

import { element, runRule } from "../test-support.ts";
import { catalogWrongRawInput } from "./catalog-wrong-raw-input.ts";

describe("catalog-wrong-raw-input", () => {
  it("reports each raw control the corpus points a component at", () => {
    for (const tag of ["select", "input", "textarea", "button"]) {
      const found = runRule(catalogWrongRawInput, element(tag));

      expect(found).toHaveLength(1);
      expect(found[0]).toContain(`raw \`<${tag}>\` in the showcase`);
    }
  });

  it("leaves the component that wraps the control alone", () => {
    expect(runRule(catalogWrongRawInput, element("Input"))).toEqual([]);
  });

  it("leaves an element that is no control alone", () => {
    expect(runRule(catalogWrongRawInput, element("div"))).toEqual([]);
  });
});
