import { describe, expect, test } from "bun:test";

import { renderGfmCorpus } from "./gfm-corpus.fixture";
import { normalizeUrl } from "./html";
import {
  createHtmlWriter,
  createUrlPolicy,
  DEFAULT_MARKDOWN_HANDLERS,
  isSafeUrl,
  listTasks,
  MARKDOWN_ELEMENTS,
  parseMarkdown,
  renderMarkdownHtml,
} from "./mod";
import type { HtmlSchema, HtmlUrlCandidate, MarkdownNodeHandler, MarkdownTask, MarkdownTaskOptions } from "./mod";
import { SPEC_SCHEMA } from "./spec-schema.fixture";

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

describe("renderMarkdownHtml under isSafeUrl", () => {
  const schema: HtmlSchema = {
    elements: { p: {}, a: { attributes: ["href"], urls: ["href"], requires: ["href"] } },
    url: (candidate) => (isSafeUrl(candidate) ? candidate.value : null),
  };

  test("renders a slash-backslash destination as a same-origin path, not a protocol-relative one", () => {
    expect(renderMarkdownHtml(parseMarkdown("[x](/\\evil.com)"), { schema })).toBe('<p><a href="/%5Cevil.com">x</a></p>');
  });

  test("drops a link whose scheme hides behind a decoded tab or control character", () => {
    expect(renderMarkdownHtml(parseMarkdown("[x](java&#9;script:alert(1))"), { schema })).toBe("<p>x</p>");
    expect(renderMarkdownHtml(parseMarkdown("[x](&#1;javascript:x)"), { schema })).toBe("<p>x</p>");
  });

  test("renders a www. autolink as text, since GFM links it over http", () => {
    expect(renderMarkdownHtml(parseMarkdown("see www.example.com"), { schema })).toBe("<p>see www.example.com</p>");
  });

  test("links a www. autolink over http under a policy listing http", () => {
    const allowsUrl = createUrlPolicy({ linkProtocols: ["http", "https"], srcProtocols: [] });
    const httpSchema: HtmlSchema = { ...schema, url: (candidate) => (allowsUrl(candidate) ? candidate.value : null) };
    expect(renderMarkdownHtml(parseMarkdown("see www.example.com"), { schema: httpSchema })).toBe(
      '<p>see <a href="http://www.example.com">www.example.com</a></p>',
    );
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

describe("renderMarkdownHtml heading offset", () => {
  const schema: HtmlSchema = {
    elements: {
      p: {},
      h1: {},
      h2: { attributes: ["class", "id"] },
      h3: {},
      h4: {},
      h5: {},
      h6: {},
      section: { attributes: ["data-footnotes", "class"] },
      ol: {},
      li: { attributes: ["id"] },
      sup: {},
      a: { attributes: ["href", "id", "data-footnote-ref", "aria-describedby", "data-footnote-backref", "aria-label", "class"], urls: ["href"] },
    },
    url: ({ value }) => value,
  };
  const ALL = parseMarkdown("# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6\n");

  test("keeps every heading at its own level with no offset or an offset of 0", () => {
    const expected = "<h1>1</h1>\n<h2>2</h2>\n<h3>3</h3>\n<h4>4</h4>\n<h5>5</h5>\n<h6>6</h6>";
    expect(renderMarkdownHtml(ALL, { schema })).toBe(expected);
    expect(renderMarkdownHtml(ALL, { schema, headingOffset: 0 })).toBe(expected);
  });

  test("moves every heading down two levels at 2, saturating at h6", () => {
    expect(renderMarkdownHtml(ALL, { schema, headingOffset: 2 })).toBe("<h3>1</h3>\n<h4>2</h4>\n<h5>3</h5>\n<h6>4</h6>\n<h6>5</h6>\n<h6>6</h6>");
  });

  test("renders every heading as h6 at 5", () => {
    expect(renderMarkdownHtml(ALL, { schema, headingOffset: 5 })).toBe("<h6>1</h6>\n<h6>2</h6>\n<h6>3</h6>\n<h6>4</h6>\n<h6>5</h6>\n<h6>6</h6>");
  });

  test("moves a setext heading as it moves an ATX one", () => {
    expect(renderMarkdownHtml(parseMarkdown("a\n===\n"), { schema, headingOffset: 2 })).toBe("<h3>a</h3>");
  });

  test("throws on an offset that is negative, past 5, fractional or NaN", () => {
    for (const headingOffset of [-1, 6, 1.5, Number.NaN])
      expect(() => renderMarkdownHtml(ALL, { schema, headingOffset })).toThrow("renderMarkdownHtml: headingOffset needs an integer from 0 to 5.");
  });

  test("an override falling back to the default heading handler honours the offset", () => {
    const heading: MarkdownNodeHandler = {
      enter: (node, context) => DEFAULT_MARKDOWN_HANDLERS.heading?.enter(node, context),
      leave: (node, context) => DEFAULT_MARKDOWN_HANDLERS.heading?.leave?.(node, context),
      layout: "inline",
    };
    expect(renderMarkdownHtml(parseMarkdown("# a"), { schema, headingOffset: 2, handlers: { heading } })).toBe("<h3>a</h3>");
  });

  test("leaves the footnote section's h2 label unshifted", () => {
    expect(renderMarkdownHtml(parseMarkdown("a[^1]\n\n[^1]: x\n"), { schema, headingOffset: 2 })).toBe(
      '<p>a<sup><a href="#user-content-fn-1" id="user-content-fnref-1" data-footnote-ref aria-describedby="footnote-label">1</a></sup></p>\n' +
        '<section data-footnotes class="footnotes"><h2 class="sr-only" id="footnote-label">Footnotes</h2>\n<ol>\n<li id="user-content-fn-1">\n<p>x <a href="#user-content-fnref-1" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">\u21a9</a></p>\n</li>\n</ol>\n</section>',
    );
  });
});

describe("renderMarkdownHtml breaks", () => {
  const schema: HtmlSchema = { elements: { p: {}, br: {}, em: {}, code: {}, ul: {}, li: {}, blockquote: {}, h1: {} }, url: ({ value }) => value };
  const rendered = (markdown: string, breaks?: boolean) => renderMarkdownHtml(parseMarkdown(markdown), { schema, breaks });

  test("writes a soft line break in a paragraph as <br>", () => {
    expect(rendered("a\nb", true)).toBe("<p>a<br>\nb</p>");
  });

  test("writes a soft break exactly as a hard break, and a hard break once", () => {
    expect(rendered("a\nb", true)).toBe(rendered("a  \nb"));
    expect(rendered("a  \nb", true)).toBe("<p>a<br>\nb</p>");
  });

  test("writes a CRLF ending, and one padded by spaces, as a single <br> and newline", () => {
    expect([rendered("a\r\nb", true), rendered("a \n b", true)]).toEqual(["<p>a<br>\nb</p>", "<p>a<br>\nb</p>"]);
  });

  test("writes a soft break inside a tight list item as <br>", () => {
    expect(rendered("- a\n  b\n- c\n", true)).toBe("<ul>\n<li>a<br>\nb</li>\n<li>c</li>\n</ul>");
  });

  test("writes a soft break inside a blockquote paragraph as <br> (task-forge: joins blockquote lines with a space)", () => {
    expect(rendered("> a\n> b\n", true)).toBe("<blockquote>\n<p>a<br>\nb</p>\n</blockquote>");
  });

  test("writes a soft break inside emphasis and a setext heading as <br>", () => {
    expect([rendered("*a\nb*", true), rendered("a\nb\n===\n", true)]).toEqual(["<p><em>a<br>\nb</em></p>", "<h1>a<br>\nb</h1>"]);
  });

  test("turns a line ending inside a code span into a space, with or without breaks", () => {
    expect([rendered("`a\nb`"), rendered("`a\nb`", true)]).toEqual(["<p><code>a b</code></p>", "<p><code>a b</code></p>"]);
  });

  test("keeps each soft break a newline without the option or with it false", () => {
    for (const breaks of [undefined, false])
      expect([rendered("a\nb", breaks), rendered("- a\n  b\n- c\n", breaks), rendered("> a\n> b\n", breaks)]).toEqual([
        "<p>a\nb</p>",
        "<ul>\n<li>a\nb</li>\n<li>c</li>\n</ul>",
        "<blockquote>\n<p>a\nb</p>\n</blockquote>",
      ]);
  });

  test("keeps only the newline when the schema does not allow br", () => {
    const withoutBr: HtmlSchema = { elements: { p: {} }, url: ({ value }) => value };
    expect(renderMarkdownHtml(parseMarkdown("a\nb"), { schema: withoutBr, breaks: true })).toBe("<p>a\nb</p>");
  });
});

describe("renderMarkdownHtml links.rel", () => {
  const schema: HtmlSchema = {
    elements: { p: {}, a: { attributes: ["href", "title", "rel"], urls: ["href"], requires: ["href"] } },
    url: (candidate) => (isSafeUrl(candidate) ? candidate.value : null),
  };
  const EVERY_LINK = parseMarkdown("[a](https://x.test) [b][r] <https://y.test> https://z.test\n\n[r]: https://r.test");

  test("writes rel after href on inline, reference, autolink and literal autolink links", () => {
    expect(renderMarkdownHtml(EVERY_LINK, { schema, links: { rel: "nofollow" } })).toBe(
      '<p><a href="https://x.test" rel="nofollow">a</a> <a href="https://r.test" rel="nofollow">b</a> ' +
        '<a href="https://y.test" rel="nofollow">https://y.test</a> <a href="https://z.test" rel="nofollow">https://z.test</a></p>',
    );
  });

  test("writes rel after a link's title", () => {
    expect(renderMarkdownHtml(parseMarkdown('[a](https://x.test "T")'), { schema, links: { rel: "nofollow" } })).toBe(
      '<p><a href="https://x.test" title="T" rel="nofollow">a</a></p>',
    );
  });

  test("writes rel on a fragment link", () => {
    expect(renderMarkdownHtml(parseMarkdown("[a](#s)"), { schema, links: { rel: "nofollow" } })).toBe('<p><a href="#s" rel="nofollow">a</a></p>');
  });

  test("writes rel on the source's link and not on a footnote call or back-reference", () => {
    const footnoteSchema: HtmlSchema = {
      ...schema,
      elements: {
        p: {},
        sup: {},
        section: { attributes: ["data-footnotes", "class"] },
        h2: { attributes: ["class", "id"] },
        ol: {},
        li: { attributes: ["id"] },
        a: {
          attributes: ["href", "rel", "id", "data-footnote-ref", "aria-describedby", "data-footnote-backref", "aria-label", "class"],
          urls: ["href"],
        },
      },
    };
    expect(renderMarkdownHtml(parseMarkdown("[a](https://x.test)[^1]\n\n[^1]: note"), { schema: footnoteSchema, links: { rel: "nofollow" } })).toBe(
      '<p><a href="https://x.test" rel="nofollow">a</a><sup><a href="#user-content-fn-1" id="user-content-fnref-1" data-footnote-ref aria-describedby="footnote-label">1</a></sup></p>\n' +
        '<section data-footnotes class="footnotes"><h2 class="sr-only" id="footnote-label">Footnotes</h2>\n<ol>\n<li id="user-content-fn-1">\n<p>note <a href="#user-content-fnref-1" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">\u21a9</a></p>\n</li>\n</ol>\n</section>',
    );
  });

  test("drops rel when the schema's a rule does not list it", () => {
    const noRel: HtmlSchema = { ...schema, elements: { p: {}, a: { attributes: ["href"], urls: ["href"], requires: ["href"] } } };
    expect(renderMarkdownHtml(parseMarkdown("[a](https://x.test)"), { schema: noRel, links: { rel: "nofollow" } })).toBe(
      '<p><a href="https://x.test">a</a></p>',
    );
  });

  test("drops a link the URL policy refuses, rel or not", () => {
    expect(renderMarkdownHtml(parseMarkdown("[a](javascript:x)"), { schema, links: { rel: "nofollow" } })).toBe("<p>a</p>");
  });

  test("writes no rel without the option", () => {
    expect(renderMarkdownHtml(EVERY_LINK, { schema })).toBe(
      '<p><a href="https://x.test">a</a> <a href="https://r.test">b</a> <a href="https://y.test">https://y.test</a> <a href="https://z.test">https://z.test</a></p>',
    );
  });

  test("a caller's link handler replaces the default and writes only its own attributes", () => {
    const link: MarkdownNodeHandler = {
      enter: (node, { writer }) => {
        if (node.type === "link") writer.open("a", [["href", node.url]]);
      },
      leave: (_node, { writer }) => writer.close(),
      layout: "inline",
    };
    expect(renderMarkdownHtml(parseMarkdown("[a](https://x.test)"), { schema, links: { rel: "nofollow" }, handlers: { link } })).toBe(
      '<p><a href="https://x.test">a</a></p>',
    );
  });

  test("a link handler falling back to the default still writes rel", () => {
    const link: MarkdownNodeHandler = {
      enter: (node, context) => DEFAULT_MARKDOWN_HANDLERS.link?.enter(node, context),
      leave: (node, context) => DEFAULT_MARKDOWN_HANDLERS.link?.leave?.(node, context),
      layout: "inline",
    };
    expect(renderMarkdownHtml(parseMarkdown("[a](https://x.test)"), { schema, links: { rel: "nofollow ugc" }, handlers: { link } })).toBe(
      '<p><a href="https://x.test" rel="nofollow ugc">a</a></p>',
    );
  });
});

describe("DEFAULT_MARKDOWN_HANDLERS", () => {
  test("is frozen, and so is each of its handlers", () => {
    expect(Object.isFrozen(DEFAULT_MARKDOWN_HANDLERS)).toBe(true);
    for (const handler of Object.values(DEFAULT_MARKDOWN_HANDLERS)) expect(Object.isFrozen(handler)).toBe(true);
  });

  test("holds no handler for the node types that need per-render state", () => {
    for (const type of ["table", "linkReference", "imageReference", "footnoteReference"])
      expect(Object.hasOwn(DEFAULT_MARKDOWN_HANDLERS, type)).toBe(false);
  });

  test("an override falling back to its code handler renders a non-svg fence as the default does", () => {
    const schema: HtmlSchema = { elements: { pre: {}, code: { attributes: ["class"] } }, url: ({ value }) => value };
    const svgCode: MarkdownNodeHandler = {
      enter: (node, context) => {
        if (node.type === "code" && node.lang === "svg") context.writer.text("svg");
        else DEFAULT_MARKDOWN_HANDLERS.code?.enter(node, context);
      },
    };
    const document = parseMarkdown("```ts\nconst a = 1;\n```\n");
    const expected = '<pre><code class="language-ts">const a = 1;\n</code></pre>';
    expect(renderMarkdownHtml(document, { schema })).toBe(expected);
    expect(renderMarkdownHtml(document, { schema, handlers: { code: svgCode } })).toBe(expected);
  });
});

describe("renderMarkdownHtml tasks", () => {
  const TASK_SCHEMA: HtmlSchema = {
    ...SPEC_SCHEMA,
    elements: { ...SPEC_SCHEMA.elements, input: { attributes: ["type", "name", "value", "checked", "disabled"] }, label: {} },
  };
  const TASKS = { name: "task" };
  const rendered = (markdown: string, tasks: MarkdownTaskOptions | undefined = TASKS, schema = TASK_SCHEMA) =>
    renderMarkdownHtml(parseMarkdown(markdown), { schema, tasks });

  test("writes each box in a tight item as a named field whose value is its line, wrapped with its text in a label", () => {
    expect(rendered("- [ ] a\n- [x] b\n")).toBe(
      '<ul>\n<li><label><input type="checkbox" name="task" value="1"> a</label></li>\n<li><label><input type="checkbox" name="task" value="2" checked> b</label></li>\n</ul>',
    );
  });

  test("puts the label inside a loose item's first paragraph and leaves its later paragraphs out of it", () => {
    expect(rendered("- [x] a\n\n  more\n- [ ] b\n")).toBe(
      '<ul>\n<li>\n<p><label><input type="checkbox" name="task" value="1" checked> a</label></p>\n<p>more</p>\n</li>\n<li>\n<p><label><input type="checkbox" name="task" value="4"> b</label></p>\n</li>\n</ul>',
    );
  });

  test("closes the label before a nested list, which carries its own boxes and lines", () => {
    expect(rendered("- [x] a\n  - [ ] b\n")).toBe(
      '<ul>\n<li><label><input type="checkbox" name="task" value="1" checked> a</label>\n<ul>\n<li><label><input type="checkbox" name="task" value="2"> b</label></li>\n</ul>\n</li>\n</ul>',
    );
  });

  test("values a box by the line of its bracket when its text continues on the next line", () => {
    expect(rendered("- [ ]\n  e\n")).toBe('<ul>\n<li><label><input type="checkbox" name="task" value="1"> e</label></li>\n</ul>');
  });

  test("writes disabled on the field only when disabled is true", () => {
    expect(rendered("- [ ] a\n", { name: "task", disabled: true })).toBe(
      '<ul>\n<li><label><input type="checkbox" name="task" value="1" disabled> a</label></li>\n</ul>',
    );
  });

  test("renders a box without a label, name or value and disabled when the option is absent, even under a schema allowing them", () => {
    expect(renderMarkdownHtml(parseMarkdown("- [x] a\n"), { schema: TASK_SCHEMA })).toBe(
      '<ul>\n<li><input type="checkbox" checked disabled> a</li>\n</ul>',
    );
  });

  test("drops the label, name and value a schema does not allow, and the box with them when input is not allowed", () => {
    expect(rendered("- [x] a\n", TASKS, SPEC_SCHEMA)).toBe('<ul>\n<li><input type="checkbox" checked> a</li>\n</ul>');
    expect(rendered("- [x] a\n", TASKS, { elements: { ul: {}, li: {} }, url: ({ value }) => value })).toBe("<ul>\n<li> a</li>\n</ul>");
  });

  test("a paragraph handler falling back to the default renders tight, loose and nested boxes as the default does", () => {
    const paragraph: MarkdownNodeHandler = {
      enter: (node, context) => DEFAULT_MARKDOWN_HANDLERS.paragraph?.enter(node, context),
      leave: (node, context) => DEFAULT_MARKDOWN_HANDLERS.paragraph?.leave?.(node, context),
      layout: "inline",
    };
    for (const markdown of ["- [ ] a\n- [x] b\n", "- [x] a\n\n  more\n- [ ] b\n", "- [x] a\n  - [ ] b\n"]) {
      const document = parseMarkdown(markdown);
      expect(renderMarkdownHtml(document, { schema: TASK_SCHEMA, tasks: { name: "task" }, handlers: { paragraph } })).toBe(
        renderMarkdownHtml(document, { schema: TASK_SCHEMA, tasks: { name: "task" } }),
      );
    }
  });

  test("hands a paragraph handler the item's task on enter and on leave, and null on a paragraph that is not the item's first child", () => {
    const seen: { phase: "enter" | "leave"; task: MarkdownTask | null }[] = [];
    const paragraph: MarkdownNodeHandler = {
      enter: (_node, { task }) => void seen.push({ phase: "enter", task }),
      leave: (_node, { task }) => void seen.push({ phase: "leave", task }),
      layout: "inline",
    };
    const document = parseMarkdown("- [x] a\n\n  more\n- [ ] b\n");
    renderMarkdownHtml(document, { schema: TASK_SCHEMA, tasks: { name: "task" }, handlers: { paragraph } });
    const [first, second] = listTasks(document);

    expect(seen).toEqual([
      { phase: "enter", task: first ?? null },
      { phase: "leave", task: first ?? null },
      { phase: "enter", task: null },
      { phase: "leave", task: null },
      { phase: "enter", task: second ?? null },
      { phase: "leave", task: second ?? null },
    ]);
    expect(listTasks(document)).toEqual([
      { line: 1, offset: 2, checked: true },
      { line: 4, offset: 18, checked: false },
    ]);
  });
});

describe("the default handlers write no inline style", () => {
  const STYLED: HtmlSchema = {
    elements: {
      ...Object.fromEntries(
        Object.entries(MARKDOWN_ELEMENTS).map(([tag, rule]) => [tag, { ...rule, attributes: [...(rule.attributes ?? []), "style"] }]),
      ),
      style: {},
    },
    url: ({ value }) => value,
  };
  const STYLE_ATTRIBUTE = /<[a-z][a-z0-9]*\b[^>]*\sstyle[\s=>]/;
  const STYLE_ELEMENT = /<style[\s>]/;
  const styled = (html: string) => STYLE_ATTRIBUTE.test(html) || STYLE_ELEMENT.test(html);

  test("no GFM corpus render writes a style attribute or a style element, under a schema allowing both everywhere", () => {
    expect(renderGfmCorpus(STYLED).filter(styled)).toEqual([]);
  });

  test("a handler that does write them is caught, under the same schema", () => {
    const thematicBreak: MarkdownNodeHandler = {
      enter: (_node, { writer }) => {
        writer.open("hr", [["style", "x"]]);
        writer.close();
        writer.open("style");
        writer.close();
      },
    };
    const html = renderMarkdownHtml(parseMarkdown("---\n"), { schema: STYLED, handlers: { thematicBreak } });

    expect({ html, attribute: STYLE_ATTRIBUTE.test(html), element: STYLE_ELEMENT.test(html) }).toEqual({
      html: '<hr style="x"><style></style>',
      attribute: true,
      element: true,
    });
  });
});
