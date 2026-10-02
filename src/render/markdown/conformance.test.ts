import { describe, expect, test } from "bun:test";

import gfm from "../../../tests/fixtures/markdown/gfm.json";
import spec from "../../../tests/fixtures/markdown/spec.json";
import { parseMarkdown, renderMarkdownHtml } from "./mod";
import { normalizeHtml } from "./normalize.fixture";
import { atSize, PATHOLOGICAL_SHAPES } from "./pathological.fixture";
import { hasRawHtml } from "./raw-html.fixture";
import { SPEC_SCHEMA } from "./spec-schema.fixture";

const BOOLEAN_ATTRIBUTE = / (checked|disabled)=""/g;

// The engine serializes as hast-util-to-html does — `>` and `"` raw in text, boolean attributes bare — and cmark's spellings are the same HTML.
function comparable(html: string): string {
  return normalizeHtml(html).replaceAll("&gt;", ">").replaceAll("&quot;", '"').replace(BOOLEAN_ATTRIBUTE, " $1");
}

function render(markdown: string): string {
  return renderMarkdownHtml(parseMarkdown(markdown), { schema: SPEC_SCHEMA });
}

// GFM links a bare URL or email address that CommonMark leaves as text, so these examples render as GFM's extended autolinks.
const GFM_AUTOLINKED: Readonly<Record<number, string>> = {
  602: '<p>&lt;<a href="https://foo.bar/baz">https://foo.bar/baz</a> bim&gt;</p>',
  608: '<p>&lt; <a href="https://foo.bar">https://foo.bar</a> &gt;</p>',
  611: '<p><a href="https://example.com">https://example.com</a></p>',
  612: '<p><a href="mailto:foo@bar.example.com">foo@bar.example.com</a></p>',
};

// micromark, which the engine matches, recognises only http(s):// and www. literals, where cmark-gfm also links ftp://.
const MICROMARK_FTP: Readonly<Record<number, (html: string) => string>> = {
  628: (html) => html.replace('<a href="ftp://foo.bar.baz">ftp://foo.bar.baz</a>', "ftp://foo.bar.baz"),
};

// cmark-gfm marks its task list examples `disabled`, so the fixture drops them; they are copied here from its spec text.
const TASK_LISTS: readonly { markdown: string; html: string }[] = [
  {
    markdown: "- [ ] foo\n- [x] bar\n",
    html: '<ul>\n<li><input disabled="" type="checkbox"> foo</li>\n<li><input checked="" disabled="" type="checkbox"> bar</li>\n</ul>\n',
  },
  {
    markdown: "- [x] foo\n  - [ ] bar\n  - [x] baz\n- [ ] bim\n",
    html: '<ul>\n<li><input checked="" disabled="" type="checkbox"> foo\n<ul>\n<li><input disabled="" type="checkbox"> bar</li>\n<li><input checked="" disabled="" type="checkbox"> baz</li>\n</ul>\n</li>\n<li><input disabled="" type="checkbox"> bim</li>\n</ul>\n',
  },
];

const GFM_SECTIONS = new Set(["Tables (extension)", "Strikethrough (extension)", "Autolinks (extension)", "Task list items (extension)"]);

const RAW_HTML = spec.examples.filter(({ markdown }) => hasRawHtml(markdown));
const MARKDOWN = spec.examples.filter(({ markdown, example }) => !hasRawHtml(markdown) && GFM_AUTOLINKED[example] === undefined);
const GFM_EXAMPLES = gfm.examples.filter(({ section, markdown }) => GFM_SECTIONS.has(section) && !hasRawHtml(markdown));

describe("the CommonMark 0.31.2 spec", () => {
  for (const { example, section, markdown, html } of MARKDOWN) {
    test(`example ${example} (${section})`, () => {
      expect(comparable(render(markdown))).toBe(comparable(html));
    });
  }

  test("excludes only the examples holding raw HTML, which the engine renders as text", () => {
    expect(RAW_HTML).toHaveLength(78);
  });

  for (const [example, html] of Object.entries(GFM_AUTOLINKED)) {
    test(`example ${example} renders as a GFM extended autolink`, () => {
      const markdown = spec.examples.find((candidate) => candidate.example === Number(example))?.markdown ?? "";
      expect(comparable(render(markdown))).toBe(comparable(html));
    });
  }
});

describe("the GFM 0.29.0.gfm.13 extensions", () => {
  for (const { example, section, markdown, html } of GFM_EXAMPLES) {
    test(`example ${example} (${section})`, () => {
      const expected = MICROMARK_FTP[example]?.(html) ?? html;
      expect(comparable(render(markdown))).toBe(comparable(expected));
    });
  }

  for (const [index, { markdown, html }] of TASK_LISTS.entries()) {
    test(`task list example ${index + 1}`, () => {
      expect(comparable(render(markdown))).toBe(comparable(html));
    });
  }

  test("covers every table, strikethrough and extended autolink example", () => {
    expect(GFM_EXAMPLES.map(({ example }) => example)).toEqual([
      198, 199, 200, 201, 202, 203, 204, 205, 491, 492, 621, 622, 623, 624, 625, 626, 627, 628, 629, 630, 631,
    ]);
  });
});

describe("normalizeHtml", () => {
  const DOCTESTS: readonly (readonly [string, string])[] = [
    ["<p>a  \t b</p>", "<p>a b</p>"],
    ["<p>a  \t\nb</p>", "<p>a b</p>"],
    ["<p>a  b</p>", "<p>a b</p>"],
    [" <p>a  b</p>", "<p>a b</p>"],
    ["<p>a  b</p> ", "<p>a b</p>"],
    ["\n\t<p>\n\t\ta  b\t\t</p>\n\t", "<p>a b</p>"],
    ["<i>a  b</i> ", "<i>a b</i> "],
    ["<br />", "<br>"],
    ['<a title="bar" HREF="foo">x</a>', '<a href="foo" title="bar">x</a>'],
    ["&forall;&amp;&gt;&lt;&quot;", "∀&amp;&gt;&lt;&quot;"],
  ];

  for (const [html, expected] of DOCTESTS) {
    test(`normalize.py's doctest ${JSON.stringify(html)}`, () => {
      expect(normalizeHtml(html)).toBe(expected);
    });
  }

  test("reads hast-util-to-html's hexadecimal escapes as the characters cmark escapes by name", () => {
    expect(normalizeHtml('<p title="&#x22;">&#x26;&#x3C;</p>\n')).toBe(normalizeHtml('<p title="&quot;">&amp;&lt;</p>\n'));
  });

  test("decodes in text only the HTML4 names Python's name2codepoint holds, as normalize.py does", () => {
    expect(normalizeHtml("&ngE;")).toBe("&ngE;");
    expect(normalizeHtml("&copy;")).toBe("©");
    expect(normalizeHtml("<p>&ngE;</p>")).not.toBe(normalizeHtml("<p>≧̸</p>"));
  });

  test("decodes HTML4's angle brackets to their HTML4 code points, not HTML5's", () => {
    expect(normalizeHtml("&lang;&rang;")).toBe("\u2329\u232a");
  });

  test("decodes every HTML5 name inside an attribute value, as html.unescape does", () => {
    expect(normalizeHtml('<a title="&ngE;">x</a>')).toBe('<a title="≧̸">x</a>');
  });

  test("keeps whitespace inside pre", () => {
    expect(normalizeHtml("<pre><code>a  \n  b\n</code></pre>\n")).toBe("<pre><code>a  \n  b\n</code></pre>");
  });

  test("is idempotent over every expected spec output", () => {
    for (const { html } of [...spec.examples, ...gfm.examples]) expect(normalizeHtml(normalizeHtml(html))).toBe(normalizeHtml(html));
  });
});

describe("the spec fixtures", () => {
  test("hold all 652 CommonMark 0.31.2 examples, numbered from 1", () => {
    expect(spec.examples.map(({ example }) => example)).toEqual(Array.from({ length: 652 }, (_, index) => index + 1));
  });

  test("hold the 672 cmark-gfm 0.29.0.gfm.13 examples less the two it marks disabled", () => {
    expect(gfm.examples).toHaveLength(670);
    expect(gfm.examples.at(-1)?.example).toBe(672);
  });

  test("tag each GFM extension example the way the spec file does", () => {
    const tagged = (extension: string) => gfm.examples.filter(({ extensions }) => extensions.includes(extension)).length;
    expect([tagged("table"), tagged("strikethrough"), tagged("autolink"), tagged("tagfilter")]).toEqual([8, 2, 11, 1]);
  });
});

describe("PATHOLOGICAL_SHAPES", () => {
  test("names each shape once", () => {
    expect(new Set(PATHOLOGICAL_SHAPES.map(({ name }) => name)).size).toBe(PATHOLOGICAL_SHAPES.length);
  });

  for (const shape of PATHOLOGICAL_SHAPES) {
    test(`${shape.name} fills a requested size without passing it`, () => {
      for (const bytes of [4096, 65_536]) {
        const input = atSize(shape, bytes);
        expect(input.length).toBeLessThanOrEqual(bytes);
        expect(input.length).toBeGreaterThan(bytes / 2);
      }
    });
  }

  test("builds reference collisions from keys cmark's 16-bucket hash sends to one bucket", () => {
    const shape = PATHOLOGICAL_SHAPES.find(({ name }) => name === "reference collisions");
    expect(shape?.generate(2)).toBe("[x19]: /url\n\n[x8]\n\n[x80]: /url\n\n[x8]\n\n");
  });
});
