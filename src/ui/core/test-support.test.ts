import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, tagOf, variantClasses } from "./test-support";

const BADGE = '<span data-slot="badge" data-tone="neutral" class="inline-flex px-2.5 text-xs">New</span>';

const PAGE = `<div data-slot="card" class="rounded-box"><span data-slot="badge" data-tone="warning" class="inline-flex px-2 text-sm">Late</span></div>`;

describe("tagOf", () => {
  it("answers the first opening tag when nothing narrows it", () => {
    expect(tagOf(PAGE)).toBe('<div data-slot="card" class="rounded-box">');
  });

  it("answers the tag whose attributes carry the selector, not the first one in the document", () => {
    expect(tagOf(PAGE, 'data-slot="badge"')).toBe('<span data-slot="badge" data-tone="warning" class="inline-flex px-2 text-sm">');
  });

  it("answers nothing for a selector no element carries, rather than the first element", () => {
    expect(tagOf(PAGE, 'data-slot="dialog"')).toBe("");
  });

  it("matches a whole attribute name, so a selector is never satisfied by a longer one", () => {
    expect(tagOf('<span data-slot-extra="badge"></span>', 'data-slot="badge"')).toBe("");
  });
});

describe("attrOf", () => {
  it("reads one attribute off the element the selector names", () => {
    expect(attrOf(PAGE, "data-tone", 'data-slot="badge"')).toBe("warning");
  });

  it("answers the empty string for an attribute the element does not carry", () => {
    expect(attrOf(BADGE, "data-appearance")).toBe("");
  });
});

describe("attrsOf", () => {
  it("reads every attribute but the class, which is what variantClasses is for", () => {
    expect(attrsOf(BADGE)).toEqual({ "data-slot": "badge", "data-tone": "neutral" });
  });

  it("reads a bare attribute as the empty string it renders as", () => {
    expect(attrsOf('<p data-ref="status" hidden class="text-sm"></p>')).toEqual({ "data-ref": "status", hidden: "" });
  });

  // A lowercase-only name pattern reads `viewBox="0 0 16 16"` as `view: ""` — a wrong record rather
  // than a missing key, which every `toEqual` over it would then be asserting against.
  it("reads a camel-cased attribute under the name it was emitted with, value intact", () => {
    expect(attrsOf('<svg data-slot="icon" viewBox="0 0 16 16" class="size-4"></svg>')).toEqual({ "data-slot": "icon", viewBox: "0 0 16 16" });
  });
});

describe("classesOf", () => {
  it("splits the class attribute into the tokens it was emitted in, in order", () => {
    expect(classesOf(BADGE)).toEqual(["inline-flex", "px-2.5", "text-xs"]);
  });

  it("answers an empty list for an element carrying no class at all", () => {
    expect(classesOf("<hr>")).toEqual([]);
  });
});

describe("variantClasses", () => {
  it("names what a variant added and what it evicted, so neither half can pass alone", () => {
    expect(variantClasses(PAGE, BADGE, 'data-slot="badge"')).toEqual({ added: ["px-2", "text-sm"], dropped: ["px-2.5", "text-xs"] });
  });

  it("answers two empty lists when a render matches its own baseline", () => {
    expect(variantClasses(BADGE, BADGE)).toEqual({ added: [], dropped: [] });
  });

  it("reports an addition that evicted nothing as an addition alone", () => {
    const wider = '<span data-slot="badge" data-tone="neutral" class="inline-flex px-2.5 text-xs uppercase">New</span>';

    expect(variantClasses(wider, BADGE)).toEqual({ added: ["uppercase"], dropped: [] });
  });
});
