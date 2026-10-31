import { describe, expect, it } from "bun:test";

import { SVG_ATTRIBUTES, SVG_TAGS } from "./svg-schema";

describe("the SVG allow-list", () => {
  it("lists attributes for every element it keeps, in SVG case", () => {
    expect(SVG_TAGS.filter((tag) => SVG_ATTRIBUTES[tag] === undefined)).toEqual([]);
    expect(SVG_TAGS).toContain("linearGradient");
  });

  it("lets only link-bearing elements carry an href", () => {
    expect(SVG_TAGS.filter((tag) => SVG_ATTRIBUTES[tag]?.includes("href"))).toEqual(["a", "use", "pattern"]);
  });

  it("never lets an element carry an event handler or a style", () => {
    const names = Object.values(SVG_ATTRIBUTES).flat();
    expect(names.filter((name) => name.startsWith("on") || name === "style")).toEqual([]);
  });
});
