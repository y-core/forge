import { describe, expect, it } from "bun:test";
import { fieldAttr } from "./field-attr";

describe("fieldAttr", () => {
  it("returns the data-field attribute for a field name", () => {
    expect(fieldAttr("gridVisible")).toEqual({ "data-field": "gridVisible" });
  });

  it("preserves the exact name (no transformation)", () => {
    expect(fieldAttr("sensitivityZoom")).toEqual({ "data-field": "sensitivityZoom" });
  });
});
