import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, attrValuesOf, classesOf, elementOf, elementsOf, innerOf, tagOf, tagsOf, variantClasses } from "./markup";

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

  it("reads through a nested element of the same name to the close that matches the opening tag", () => {
    expect(elementOf('<div id="a"><div>x</div><p>y</p></div><div>z</div>', "div", 'id="a"')).toBe('<div id="a"><div>x</div><p>y</p></div>');
  });

  it("matches the close of a list nested two deep", () => {
    const list = '<ul data-ref="top"><li><ul><li><ul><li>c</li></ul></li></ul></li><li>d</li></ul>';
    expect(elementOf(`${list}<ul><li>e</li></ul>`, "ul", 'data-ref="top"')).toBe(list);
  });

  it("counts no void element among the children as an opening", () => {
    expect(elementOf('<p data-ref="v">a<br>b<img src="/i.png" alt="">c</p><p>d</p>', "p", 'data-ref="v"')).toBe(
      '<p data-ref="v">a<br>b<img src="/i.png" alt="">c</p>',
    );
  });

  it("counts no self-closing tag of the same name as an opening", () => {
    expect(elementOf('<div id="s"><div /><div/>x</div></div>', "div", 'id="s"')).toBe('<div id="s"><div /><div/>x</div>');
  });

  it("counts no longer tag name that begins with the same letters", () => {
    expect(elementOf('<dl id="d"><dlx><dt>t</dt></dl><p>after</p>', "dl", 'id="d"')).toBe('<dl id="d"><dlx><dt>t</dt></dl>');
  });

  it("matches no longer tag name for a selector either", () => {
    expect(elementOf('<spanner id="a">x</spanner><span id="a">y</span>', "span", 'id="a"')).toBe('<span id="a">y</span>');
    expect(tagOf('<spanner id="a">', 'id="a"')).toBe('<spanner id="a">');
  });

  it("answers nothing for an element whose closing tag never comes", () => {
    expect(elementOf('<div id="u"><div>x</div>', "div", 'id="u"')).toBe("");
  });
});

describe("tagsOf", () => {
  it("answers no tags for a selector no element carries", () => {
    expect(tagsOf(PAGE, 'data-ref="missing"')).toEqual([]);
  });

  it("answers the one opening tag carrying the selector", () => {
    expect(tagsOf(PAGE, 'data-ref="outcome"')).toEqual(['<p class="text-muted-foreground" data-ref="outcome">']);
  });

  it("answers every opening tag carrying the selector, in document order", () => {
    expect(tagsOf(PAGE, "name")).toEqual(['<meta name="robots" content="noindex">', '<input name="_csrf" value="t">']);
  });
});

describe("elementsOf", () => {
  it("answers no elements for a tag the page never renders", () => {
    expect(elementsOf(PAGE, "h1")).toEqual([]);
  });

  it("answers the one element of the tag", () => {
    expect(elementsOf(PAGE, "title")).toEqual(["<title>Forge &amp; Co</title>"]);
  });

  it("answers every element of the tag, in document order", () => {
    expect(elementsOf(PAGE, "p")).toEqual(['<p class="lead">Save &amp; Exit</p>', '<p class="text-muted-foreground" data-ref="outcome">Done</p>']);
  });

  it("answers a nested element of the same name whole within the outer and again as its own entry", () => {
    expect(elementsOf("<ul data-x><li>a<ul data-x><li>b</li></ul></li></ul><ul data-x></ul>", "ul", "data-x")).toEqual([
      "<ul data-x><li>a<ul data-x><li>b</li></ul></li></ul>",
      "<ul data-x><li>b</li></ul>",
      "<ul data-x></ul>",
    ]);
  });

  it("answers each void element as its opening tag alone", () => {
    expect(elementsOf(PAGE, "meta")).toEqual(['<meta charset="utf-8">', '<meta name="robots" content="noindex">']);
  });

  it("leaves out an element whose closing tag never comes", () => {
    expect(elementsOf('<div id="u"><div>x</div>', "div")).toEqual(["<div>x</div>"]);
  });
});

describe("attrValuesOf", () => {
  it("answers no values when no element matches", () => {
    expect(attrValuesOf(PAGE, "value", 'name="missing"')).toEqual([]);
  });

  it("answers the one value the selected element carries", () => {
    expect(attrValuesOf(PAGE, "value", 'name="_csrf"')).toEqual(["t"]);
  });

  it("answers every value in document order, skipping a matched element that does not carry the attribute", () => {
    expect(attrValuesOf('<option value="a"><option><option value="">', "value")).toEqual(["a", ""]);
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

describe("camelCase SVG elements", () => {
  const SVG =
    '<svg><defs><linearGradient id="g" style="x"><stop offset="0"></stop></linearGradient>' +
    '<clipPath id="c"></clipPath><filter><feGaussianBlur stdDeviation="2"></feGaussianBlur></filter></defs></svg>';

  it("lists a camelCase element's opening tag", () => {
    expect(tagsOf(SVG)).toEqual([
      "<svg>",
      "<defs>",
      '<linearGradient id="g" style="x">',
      '<stop offset="0">',
      '<clipPath id="c">',
      "<filter>",
      '<feGaussianBlur stdDeviation="2">',
    ]);
  });

  it("reads an attribute a camelCase element carries", () => {
    expect(attrValuesOf(SVG, "style")).toEqual(["x"]);
  });

  it("sees an attribute carried only by camelCase elements, so an absence check over it fails", () => {
    const styled =
      '<svg><linearGradient style="a"></linearGradient><clipPath style="b"></clipPath>' +
      '<feGaussianBlur style="c"></feGaussianBlur><rect></rect></svg>';
    expect(attrValuesOf(styled, "style")).toEqual(["a", "b", "c"]);
  });

  it("reads the opening tag of the first camelCase element carrying the selector", () => {
    expect(tagOf(SVG, 'id="c"')).toBe('<clipPath id="c">');
  });

  it("reads an attribute of the first camelCase element carrying the selector", () => {
    expect(attrOf(SVG, "id", 'style="x"')).toBe("g");
  });

  it("strips a camelCase element's own tags", () => {
    expect(innerOf(elementOf(SVG, "linearGradient"))).toBe('<stop offset="0"></stop>');
  });
});
