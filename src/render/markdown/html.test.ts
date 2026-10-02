import { describe, expect, test } from "bun:test";

import { normalizeUrl } from "./html";
import { createHtmlWriter, parseMarkdown, renderMarkdownHtml } from "./mod";
import type { HtmlSchema, HtmlUrlCandidate } from "./mod";

const SCHEMA: HtmlSchema = {
  elements: {
    p: {},
    em: {},
    a: { attributes: ["href", "title"], urls: ["href"], requires: ["href"] },
    img: { attributes: ["src", "alt"], urls: ["src"] },
  },
  url: ({ value }) => (value.startsWith("javascript:") ? null : value),
};

function written(build: (writer: ReturnType<typeof createHtmlWriter>) => void): string {
  const writer = createHtmlWriter(SCHEMA);
  build(writer);
  return writer.html();
}

describe("createHtmlWriter", () => {
  test("drops an element outside the schema and keeps its text, escaped", () => {
    expect(
      written((w) => {
        w.open("script");
        w.text("<b>&");
        w.close();
      }),
    ).toBe("&#x3C;b>&#x26;");
  });

  test("drops an attribute the element's rule does not allow", () => {
    expect(
      written((w) => {
        w.open("p", [
          ["onclick", "x"],
          ["class", "y"],
        ]);
        w.close();
      }),
    ).toBe("<p></p>");
  });

  test("drops a URL attribute the policy refuses, and unwraps an element that needed it", () => {
    expect(
      written((w) => {
        w.open("a", [
          ["href", "javascript:alert(1)"],
          ["title", "t"],
        ]);
        w.text("label");
        w.close();
      }),
    ).toBe("label");
    expect(
      written((w) => {
        w.open("img", [
          ["src", "javascript:x"],
          ["alt", "a"],
        ]);
        w.close();
      }),
    ).toBe('<img alt="a">');
  });

  test("hands the URL policy the value as written, its attribute and its element", () => {
    const seen: HtmlUrlCandidate[] = [];
    const writer = createHtmlWriter({
      elements: { a: { attributes: ["href"], urls: ["href"] }, img: { attributes: ["src"], urls: ["src"] } },
      url: (candidate) => (seen.push(candidate), candidate.value),
    });
    writer.open("a", [["href", "/a b"]]);
    writer.close();
    writer.open("img", [["src", "x.png"]]);

    expect(seen).toEqual([
      { value: "/a b", attribute: "href", tag: "a" },
      { value: "x.png", attribute: "src", tag: "img" },
    ]);
  });

  test("escapes attribute values in hast-util-to-html's hexadecimal forms, and `<` and `>` as well", () => {
    expect(
      written((w) => {
        w.open("a", [
          ["href", "/"],
          ["title", `&"'\`<>`],
        ]);
        w.close();
      }),
    ).toBe('<a href="/" title="&#x26;&#x22;&#x27;&#x60;&#x3c;&#x3e;"></a>');
  });
});

describe("normalizeUrl", () => {
  test("percent-encodes what micromark's normalizeUri encodes and keeps existing escapes", () => {
    expect(normalizeUrl('a b"<>\\[]^`{|}')).toBe("a%20b%22%3C%3E%5C%5B%5D%5E%60%7B%7C%7D");
    expect(normalizeUrl("%41%zz%")).toBe("%41%zz%25");
    expect(normalizeUrl("ä\u{1f600}\ud800")).toBe("%C3%A4%F0%9F%98%80%EF%BF%BD");
  });
});

describe("renderMarkdownHtml line anchors", () => {
  test("marks each top-level element with the line it starts on, a list once for all its items", () => {
    const schema: HtmlSchema = {
      elements: { p: { attributes: ["data-line"] }, ul: { attributes: ["data-line"] }, li: {} },
      url: ({ value }) => value,
    };
    expect(renderMarkdownHtml(parseMarkdown("a\n\n- b\n- c\n\nd\n"), { schema, lineAnchors: true })).toBe(
      '<p data-line="1">a</p>\n<ul data-line="3">\n<li>b</li>\n<li>c</li>\n</ul>\n<p data-line="6">d</p>',
    );
  });
});
