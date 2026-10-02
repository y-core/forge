import { describe, expect, it } from "bun:test";

import { createHtmlWriter } from "./html";
import { sanitizeSvg, tokenizeSvg, writeSvg } from "./svg";
import { isSafeUrl, SVG_ATTRIBUTES, SVG_TAGS } from "./svg-schema";
import type { ElementRule, HtmlSchema } from "./types";

const SVG_SCHEMA: HtmlSchema = {
  elements: Object.fromEntries(
    SVG_TAGS.map((tag): [string, ElementRule] => [
      tag === "a" ? "svgA" : tag,
      { attributes: ["id", ...(SVG_ATTRIBUTES[tag] ?? [])], urls: ["href", "xlink:href"], ...(tag === "a" ? { tag: "a" } : {}) },
    ]),
  ),
  url: (candidate) => (isSafeUrl(candidate) ? candidate.value : null),
};

function written(markup: string): string {
  const clean = sanitizeSvg(markup);
  if (clean === null) return "null";
  const writer = createHtmlWriter(SVG_SCHEMA);
  writeSvg(clean, writer);
  return writer.html();
}

describe("tokenizeSvg", () => {
  it("answers the root element with its attributes in order and its children", () => {
    expect(tokenizeSvg('<svg a="1" b="2"><g/>t</svg>')).toEqual({
      name: "svg",
      attributes: [
        ["a", "1"],
        ["b", "2"],
      ],
      children: [{ name: "g", attributes: [], children: [] }, "t"],
    });
  });

  it("honours a self-closing tag, so the next element is its sibling", () => {
    expect(written("<svg><circle/><rect/></svg>")).toBe("<svg><circle></circle><rect></rect></svg>");
  });

  for (const [name, markup] of [
    ["an unquoted attribute value", "<svg><rect width=1></rect></svg>"],
    ["an attribute written twice", '<svg><rect width="1" WIDTH="2"></rect></svg>'],
    ["an unknown named reference", "<svg><text>&nosuch;</text></svg>"],
    ["an unterminated reference", "<svg><text>a &amp b</text></svg>"],
    ["a raw < in text", "<svg><text>a < b</text></svg>"],
    ["a mismatched closing tag", "<svg><g></text></svg>"],
    ["an unclosed element", "<svg><g></svg>"],
    ["a CDATA section", "<svg><text><![CDATA[x]]></text></svg>"],
    ["a processing instruction inside the root", "<svg><?php x ?></svg>"],
    ["a DOCTYPE with an internal subset", '<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>'],
    ["nesting past 64 levels", "<svg>" + "<g>".repeat(64) + "</g>".repeat(64) + "</svg>"],
  ] as const) {
    it(`refuses ${name}, so the fence renders as code`, () => {
      expect(written(markup)).toBe("null");
    });
  }

  it("accepts an xml declaration, a DOCTYPE and comments before the root, and XML, numeric and named references", () => {
    expect(written('<?xml version="1.0"?>\n<!DOCTYPE svg>\n<!-- c --><svg><text>&lt;&#65;&#x42;&eacute;&apos;</text></svg>')).toBe(
      "<svg><text>&#x3C;ABé'</text></svg>",
    );
  });

  it("accepts nesting of exactly 64 levels", () => {
    expect(written("<svg>" + "<g>".repeat(63) + "</g>".repeat(63) + "</svg>")).toBe("<svg>" + "<g>".repeat(63) + "</g>".repeat(63) + "</svg>");
  });
});

describe("sanitizeSvg", () => {
  it("writes element and attribute names in their SVG case, whatever case the fence used", () => {
    expect(written('<SVG VIEWBOX="0 0 1 1"><lineargradient GradientUnits="userSpaceOnUse"></lineargradient></SVG>')).toBe(
      '<svg viewBox="0 0 1 1"><linearGradient gradientUnits="userSpaceOnUse"></linearGradient></svg>',
    );
  });

  it("drops an xml declaration and comments beside the svg root", () => {
    expect(written('<?xml version="1.0"?><!-- a --><svg><!-- b --><g></g></svg><!-- c -->')).toBe("<svg><g></g></svg>");
  });

  it("answers null when the root is not an svg", () => {
    expect(written("<g><text>a</text></g>")).toBe("null");
  });

  it("answers null when the root is a disallowed element", () => {
    expect(written("<foreignObject><text>a</text></foreignObject>")).toBe("null");
  });

  it("strips script, style and foreignObject with their content", () => {
    expect(written("<svg><script>a</script><style>b</style><foreignObject>c</foreignObject><text>d</text></svg>")).toBe(
      "<svg><text>d</text></svg>",
    );
  });

  it("keeps geometry and presentation attributes on a shape", () => {
    expect(written('<svg><path d="M0 0" fill="red" stroke-width="2" transform="scale(2)"></path></svg>')).toBe(
      '<svg><path d="M0 0" fill="red" stroke-width="2" transform="scale(2)"></path></svg>',
    );
  });

  it("answers null for two svg roots", () => {
    expect(written("<svg></svg><svg></svg>")).toBe("null");
  });

  it("answers null for text beside the svg root", () => {
    expect(written("x <svg></svg>")).toBe("null");
  });

  it("answers the one svg root when only a comment and whitespace surround it", () => {
    expect(written("<!-- c -->\n<svg><text>a</text></svg>\n")).toBe("<svg><text>a</text></svg>");
  });

  it("answers null for an HTML element that would carry a browser out of the svg", () => {
    expect(written("<svg><p><style>*{x:y}</style></p><text>a</text></svg>")).toBe("null");
  });

  it("keeps an HTML element inside an integration point, which is stripped with it", () => {
    expect(written("<svg><foreignObject><div>x</div></foreignObject><text>a</text></svg>")).toBe("<svg><text>a</text></svg>");
  });

  // HTML parses an element inside `<title>` or `<desc>` as HTML, where `<title>` is raw text a `</title>` in an attribute would close.
  it("keeps only the text of an element inside <title>", () => {
    expect(written('<svg><title>a<title><text dx="1">b</text></title>c</title></svg>')).toBe("<svg><title>abc</title></svg>");
  });

  it("unwraps an element outside the SVG subset, keeping its children", () => {
    expect(written('<svg><switch><text>a</text></switch><image href="https://x/a.png"></image></svg>')).toBe("<svg><text>a</text></svg>");
  });
});
