import { describe, expect, it } from "bun:test";

import { isSafeUrl, SVG_ATTRIBUTES, SVG_TAGS } from "./svg-schema";

describe("isSafeUrl", () => {
  it("keeps a relative, fragment or query URL on any attribute", () => {
    expect([
      isSafeUrl({ attribute: "href", value: "/p/1" }),
      isSafeUrl({ attribute: "href", value: "#md-fn-1" }),
      isSafeUrl({ attribute: "src", value: "a.png" }),
      isSafeUrl({ attribute: "href", value: "?q=a:b" }),
    ]).toEqual([true, true, true, true]);
  });

  it("keeps https and mailto on a link, and only https on an image source", () => {
    expect([
      isSafeUrl({ attribute: "href", value: "https://example.com" }),
      isSafeUrl({ attribute: "href", value: "mailto:a@example.com" }),
      isSafeUrl({ attribute: "xlink:href", value: "https://example.com" }),
      isSafeUrl({ attribute: "src", value: "https://example.com/a.png" }),
      isSafeUrl({ attribute: "src", value: "mailto:a@example.com" }),
    ]).toEqual([true, true, true, true, false]);
  });

  it("refuses every other scheme, in any case", () => {
    expect(
      ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:msgbox(1)", "http://x.com"].map((url) =>
        isSafeUrl({ attribute: "href", value: url }),
      ),
    ).toEqual([false, false, false, false, false]);
  });

  it("refuses a scheme hidden behind leading controls, spaces or an embedded tab", () => {
    expect([
      isSafeUrl({ attribute: "href", value: "   javascript:alert(1)" }),
      isSafeUrl({ attribute: "href", value: "\u0001javascript:x" }),
      isSafeUrl({ attribute: "href", value: "java\tscript:x" }),
    ]).toEqual([false, false, false]);
  });

  it("refuses a protocol-relative URL, with either slash", () => {
    expect([
      isSafeUrl({ attribute: "href", value: "//evil.test" }),
      isSafeUrl({ attribute: "href", value: "\\\\evil.test" }),
      isSafeUrl({ attribute: "src", value: " //evil.test" }),
    ]).toEqual([false, false, false]);
  });

  it("refuses every scheme on an attribute it lists no protocols for", () => {
    expect([isSafeUrl({ attribute: "title", value: "https://example.com" }), isSafeUrl({ attribute: "title", value: "/relative" })]).toEqual([
      false,
      true,
    ]);
  });
});

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
