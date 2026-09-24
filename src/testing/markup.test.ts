import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, elementOf, innerOf, tagOf, variantClasses } from "./markup";

const PAGE =
  '<html><head><title>Forge &amp; Co</title><meta charset="utf-8"><meta name="robots" content="noindex"></head>' +
  '<body><p class="lead">Save &amp; Exit</p><p class="text-muted-foreground" data-ref="outcome">Done</p>' +
  '<svg viewBox="0 0 24 24"><use href="/s.svg#a"></use></svg><input name="_csrf" value="t"></body></html>';

describe("tagOf", () => {
  it("reads the first opening tag when no selector is given", () => {
    expect(tagOf(PAGE)).toBe("<html>");
  });

  it("reads the opening tag of the first element carrying the selector", () => {
    expect(tagOf(PAGE, 'data-ref="outcome"')).toBe('<p class="text-muted-foreground" data-ref="outcome">');
  });

  it("answers nothing for a selector no element carries", () => {
    expect(tagOf(PAGE, 'data-ref="missing"')).toBe("");
  });

  it("matches a whole attribute name, so a selector is never satisfied by a longer one", () => {
    expect(tagOf('<span data-ref-extra="outcome"></span>', 'data-ref="outcome"')).toBe("");
  });
});

describe("elementOf", () => {
  it("reads the whole first element of the tag, entities as rendered", () => {
    expect(elementOf(PAGE, "title")).toBe("<title>Forge &amp; Co</title>");
  });

  it("reads the element the selector names rather than the first of its tag", () => {
    expect(elementOf(PAGE, "p", 'data-ref="outcome"')).toBe('<p class="text-muted-foreground" data-ref="outcome">Done</p>');
  });

  it("reads a void element as its opening tag alone", () => {
    expect(elementOf(PAGE, "meta", 'name="robots"')).toBe('<meta name="robots" content="noindex">');
  });

  it("does not let a tag name match a longer one", () => {
    expect(elementOf("<span>x</span><spanner>y</spanner>", "spanner")).toBe("<spanner>y</spanner>");
    expect(elementOf("<spanner>y</spanner>", "span")).toBe("");
  });

  it("answers nothing for a tag the page never renders", () => {
    expect(elementOf(PAGE, "h1")).toBe("");
  });
});

describe("attrOf", () => {
  it("reads one attribute off the selected element", () => {
    expect(attrOf(PAGE, "content", 'name="robots"')).toBe("noindex");
  });

  it("reads off a whole element handed to it, so an extracted element needs no selector", () => {
    expect(attrOf(elementOf(PAGE, "input"), "value")).toBe("t");
  });

  it("answers nothing for an attribute the element does not carry", () => {
    expect(attrOf(PAGE, "content", 'charset="utf-8"')).toBe("");
  });
});

describe("attrsOf", () => {
  it("records every attribute but class, a bare one as the empty string", () => {
    expect(attrsOf('<details open data-slot="navbar" class="static">', "")).toEqual({ open: "", "data-slot": "navbar" });
  });

  it("keeps the case of a mixed-case attribute name", () => {
    expect(attrsOf(PAGE, 'viewBox="0 0 24 24"')).toEqual({ viewBox: "0 0 24 24" });
  });
});

describe("classesOf", () => {
  it("splits the class list into its tokens in emitted order", () => {
    expect(classesOf('<a class="px-2 font-bold">x</a>')).toEqual(["px-2", "font-bold"]);
  });

  it("answers an empty list for an element carrying no class", () => {
    expect(classesOf("<a>x</a>")).toEqual([]);
  });
});

describe("variantClasses", () => {
  const BADGE = '<span data-slot="badge" class="inline-flex px-2.5 text-xs">New</span>';

  it("names what a variant added and what it evicted, so neither half can pass alone", () => {
    const variant = '<span data-slot="badge" class="inline-flex px-2 text-sm">Late</span>';
    expect(variantClasses(variant, BADGE)).toEqual({ added: ["px-2", "text-sm"], dropped: ["px-2.5", "text-xs"] });
  });

  it("reports an addition that evicted nothing as an addition alone", () => {
    const wider = '<span data-slot="badge" class="inline-flex px-2.5 text-xs uppercase">New</span>';
    expect(variantClasses(wider, BADGE)).toEqual({ added: ["uppercase"], dropped: [] });
  });

  it("answers two empty lists when a render matches its own baseline", () => {
    expect(variantClasses(BADGE, BADGE)).toEqual({ added: [], dropped: [] });
  });

  it("reads the element the selector names on both sides rather than the first one", () => {
    const wrapped = `<div data-slot="card" class="rounded-box">${BADGE}</div>`;
    expect(variantClasses(wrapped, PAGE, 'data-slot="badge"')).toEqual({ added: ["inline-flex", "px-2.5", "text-xs"], dropped: [] });
  });
});

describe("innerOf", () => {
  it("strips the element's own tags and keeps the children", () => {
    expect(innerOf(elementOf(PAGE, "svg"))).toBe('<use href="/s.svg#a"></use>');
  });

  it("strips a bare tag as it strips one with attributes", () => {
    expect(innerOf("<title>Forge &amp; Co</title>")).toBe("Forge &amp; Co");
  });
});
