import { describe, expect, test } from "bun:test";

import { MAX_TABLE_COLUMNS } from "./block";
import { parseMarkdown, renderMarkdownHtml } from "./mod";
import type { HtmlSchema } from "./mod";
import { SPEC_SCHEMA } from "./spec-schema.fixture";

const FOOTNOTE_SCHEMA: HtmlSchema = {
  ...SPEC_SCHEMA,
  elements: {
    ...SPEC_SCHEMA.elements,
    sup: {},
    section: { attributes: ["data-footnotes", "class"] },
    h2: { attributes: ["class", "id"] },
    li: { attributes: ["id"] },
    a: { attributes: ["href", "id", "data-footnote-ref", "aria-describedby", "data-footnote-backref", "aria-label", "class"], urls: ["href"] },
  },
};

function render(markdown: string, schema: HtmlSchema = SPEC_SCHEMA): string {
  return renderMarkdownHtml(parseMarkdown(markdown), { schema });
}

function footnoteItem(html: string, id: string): string {
  const start = html.indexOf(`<li id="user-content-fn-${id}">`);
  return html.slice(start, html.indexOf("</li>", start) + "</li>".length);
}

function row(cells: number): string {
  return "|" + " a |".repeat(cells) + "\n";
}

function delimiter(cells: number): string {
  return "|" + " - |".repeat(cells) + "\n";
}

describe("table width", () => {
  test(`reads a delimiter row of ${MAX_TABLE_COLUMNS} columns as a table and one of ${MAX_TABLE_COLUMNS + 1} as paragraph text`, () => {
    expect(MAX_TABLE_COLUMNS).toBe(128);
    expect(render(row(128) + delimiter(128))).toStartWith("<table>");
    expect(render(row(129) + delimiter(129))).toStartWith("<p>");
  });

  test("pads short rows only while the padding stays within one cell per source character", () => {
    const source = row(128) + delimiter(128) + "|\n".repeat(64);
    const cells = render(source).split("<td>").length - 1;
    expect(cells).toBe(64 + source.length);
  });
});

describe("table header rows", () => {
  test("need an indent under four columns, as an indented line could not start a block of its own", () => {
    const types = (markdown: string) => parseMarkdown(markdown).units.map(({ node }) => node.type);
    expect(types("x\n   | a | b |\n|---|---|\n")).toEqual(["paragraph", "table"]);
    expect(types("x\n    | a | b |\n|---|---|\n")).toEqual(["paragraph"]);
    expect(types("x\n\t| a | b |\n|---|---|\n")).toEqual(["paragraph"]);
  });
});

describe("footnotes", () => {
  test("number calls by first use, back-reference every call, and render only what is called", () => {
    expect(render("b[^b] a[^a] b[^B]\n\n[^a]: Alpha.\n[^b]: Beta.\n[^c]: Unused.\n", FOOTNOTE_SCHEMA)).toBe(
      "<p>b" +
        '<sup><a href="#user-content-fn-b" id="user-content-fnref-b" data-footnote-ref aria-describedby="footnote-label">1</a></sup> a' +
        '<sup><a href="#user-content-fn-a" id="user-content-fnref-a" data-footnote-ref aria-describedby="footnote-label">2</a></sup> b' +
        '<sup><a href="#user-content-fn-b" id="user-content-fnref-b-2" data-footnote-ref aria-describedby="footnote-label">1</a></sup></p>\n' +
        '<section data-footnotes class="footnotes"><h2 class="sr-only" id="footnote-label">Footnotes</h2>\n<ol>\n' +
        '<li id="user-content-fn-b">\n<p>Beta. ' +
        '<a href="#user-content-fnref-b" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">↩</a> ' +
        '<a href="#user-content-fnref-b-2" data-footnote-backref="" aria-label="Back to reference 1-2" class="data-footnote-backref">↩<sup>2</sup></a></p>\n</li>\n' +
        '<li id="user-content-fn-a">\n<p>Alpha. ' +
        '<a href="#user-content-fnref-a" data-footnote-backref="" aria-label="Back to reference 2" class="data-footnote-backref">↩</a></p>\n</li>\n' +
        "</ol>\n</section>",
    );
  });

  test("back-reference a call a definition makes to itself, counted after its content renders", () => {
    expect(footnoteItem(render("x[^a]\n\n[^a]: self[^a]\n", FOOTNOTE_SCHEMA), "a")).toBe(
      '<li id="user-content-fn-a">\n<p>self' +
        '<sup><a href="#user-content-fn-a" id="user-content-fnref-a-2" data-footnote-ref aria-describedby="footnote-label">1</a></sup> ' +
        '<a href="#user-content-fnref-a" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">↩</a> ' +
        '<a href="#user-content-fnref-a-2" data-footnote-backref="" aria-label="Back to reference 1-2" class="data-footnote-backref">↩<sup>2</sup></a>' +
        "</p>\n</li>",
    );
  });

  test("back-reference only the calls made before a definition renders when two definitions cite each other", () => {
    expect(footnoteItem(render("x[^a]\n\n[^a]: see[^b]\n[^b]: see[^a]\n", FOOTNOTE_SCHEMA), "a")).toBe(
      '<li id="user-content-fn-a">\n<p>see' +
        '<sup><a href="#user-content-fn-b" id="user-content-fnref-b" data-footnote-ref aria-describedby="footnote-label">2</a></sup> ' +
        '<a href="#user-content-fnref-a" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">↩</a>' +
        "</p>\n</li>",
    );
  });

  test("leave a call to an undefined label, or one holding whitespace, as text", () => {
    expect(render("a[^x] b[^a b]\n", FOOTNOTE_SCHEMA)).toBe("<p>a[^x] b[^a b]</p>");
  });

  test("take a definition's indented continuation lines into it", () => {
    const { units } = parseMarkdown("[^n]: one\n\n    two\n\nthree\n");
    expect(units.map(({ node }) => node.type)).toEqual(["footnoteDefinition", "paragraph"]);
    expect(units[0]?.node.type === "footnoteDefinition" ? units[0].node.children.map(({ type }) => type) : []).toEqual(["paragraph", "paragraph"]);
  });
});

describe("task list items", () => {
  test("need whitespace after the marker and content in the paragraph", () => {
    const checked = (markdown: string) => parseMarkdown(markdown).units.map(({ node }) => (node.type === "listItem" ? node.checked : undefined));
    expect(checked("- [ ] a\n- [x] b\n- [X] c\n- [x]\n- [x]d\n- [ ]\n  e\n- [  ] f\n")).toEqual([false, true, true, null, null, false, null]);
  });
});

describe("extended www autolinks", () => {
  test("leaves a www. literal right after a slash as text, as micromark's tokenizer does", () => {
    expect(render("a //www.example.com b\n")).toBe("<p>a //www.example.com b</p>");
  });
});

// cmark-gfm links literals in the text a link leaves behind, so a `[` that closes no link does not stop one.
describe("literal autolinks beside brackets", () => {
  test("links a URL after a [ that never closes a link", () => {
    expect(render("Docs [WIP: https://x.com/docs]\n")).toBe('<p>Docs [WIP: <a href="https://x.com/docs">https://x.com/docs</a>]</p>');
  });

  test("links an email address inside brackets that are not a link", () => {
    expect(render("[ask a@b.co]\n")).toBe('<p>[ask <a href="mailto:a@b.co">a@b.co</a>]</p>');
  });

  test("leaves a URL inside link text as text, since a link holds no link", () => {
    expect(render("[see https://x.com](/u)\n")).toBe('<p><a href="/u">see https://x.com</a></p>');
  });

  test("leaves a URL inside an image description as alt text", () => {
    expect(render("![see https://x.com](/u)\n")).toBe('<p><img src="/u" alt="see https://x.com"></p>');
  });

  // cmark-gfm resolves link text before it looks for literals, so the text keeps every construct a URL inside it touches.
  for (const [name, markdown, text] of [
    ["an escaped ]", "[x https://a.com/\\] y](u)\n", "x https://a.com/] y"],
    ["an escaped ] at its end", "[docs https://a.com/x\\]](u)\n", "docs https://a.com/x]"],
    ["an escaped ] after a www. literal", "[x www.a.com\\] y](u)\n", "x www.a.com] y"],
    ["a code span", "[x https://a.com/`]` y](u)\n", "x https://a.com/<code>]</code> y"],
    ["emphasis", "[x https://a.com/*b* y](u)\n", "x https://a.com/<em>b</em> y"],
    ["a character reference", "[x https://a.com/&amp; y](u)\n", "x https://a.com/&#x26; y"],
  ] as const) {
    test(`keeps ${name} in link text beside a URL`, () => {
      expect(render(markdown)).toBe(`<p><a href="u">${text}</a></p>`);
    });
  }

  test("links a URL inside brackets through an intraword _, a query and a fragment, none of which the parser acts on", () => {
    expect(render("[a https://x.com/a_b?c=d#e]\n")).toBe('<p>[a <a href="https://x.com/a_b?c=d#e">https://x.com/a_b?c=d#e</a>]</p>');
  });

  test("lets a shortcut reference close on a ] the URL would otherwise have swallowed", () => {
    expect(render("[https://x.com/]bar\n\n[https://x.com/]: /u\n")).toBe('<p><a href="/u">https://x.com/</a>bar</p>');
  });
});

// GFM's task list item marker holds a whitespace character or an `x` between its brackets, and a tab is whitespace.
describe("task list markers", () => {
  test("reads a tab between the brackets as an unchecked task", () => {
    expect(render("- [\t] a\n")).toBe('<ul>\n<li><input type="checkbox" disabled> a</li>\n</ul>');
  });
});

// GFM's extended email autolink starts with one or more of alphanumerics, `.`, `-`, `_` or `+`, so `_` may lead one.
describe("extended email autolinks", () => {
  test("links an address that starts with _", () => {
    expect(render("_a@b.co\n")).toBe('<p><a href="mailto:_a@b.co">_a@b.co</a></p>');
  });

  test("still reads _ as emphasis where no address follows", () => {
    expect(render("_em_\n")).toBe("<p><em>em</em></p>");
  });
});
