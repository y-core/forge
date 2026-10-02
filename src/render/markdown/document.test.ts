import { describe, expect, test } from "bun:test";

import fc from "fast-check";

import { mixedMarkdown, structuredMarkdown } from "./arbitraries.fixture";
import { parseDialect } from "./dialect.fixture";
import { createUnitCache, parseMarkdown, scanBlocks } from "./mod";
import type { UnitCache } from "./mod";
import { COMMONMARK } from "./syntax";
import { shapeOf } from "./tree.fixture";
import { walkMarkdown } from "./walk";

const SEED = 261003;
const RUNS = 2000;
const BYTE_ORDER_MARK = 0xfeff;

const leadingMarks = fc.tuple(fc.boolean(), fc.boolean()).map(([first, later]) => (source: string) => {
  const marked = later ? source.replaceAll("\n\n", "\n\n\u{feff}") : source;
  return first ? "\u{feff}" + marked : marked;
});

const markdown = fc
  .tuple(
    fc.oneof(
      mixedMarkdown,
      structuredMarkdown.map(({ md }) => md),
    ),
    leadingMarks,
  )
  .map(([source, mark]) => mark(source));

const edit = fc.record({ at: fc.double({ min: 0, max: 1, noNaN: true }), remove: fc.nat({ max: 20 }), insert: mixedMarkdown });

function applyEdit(source: string, { at, remove, insert }: { at: number; remove: number; insert: string }): string {
  const start = Math.floor(at * source.length);
  return source.slice(0, start) + insert + source.slice(start + remove);
}

function createLoggingCache(): { cache: UnitCache; parsed: string[] } {
  const inner = createUnitCache();
  const parsed: string[] = [];
  return {
    parsed,
    cache: {
      get: (text) => inner.get(text),
      set(text, entry) {
        parsed.push(text);
        inner.set(text, entry);
      },
    },
  };
}

describe("units", () => {
  test("scan alone to the block structure they have inside the whole document", () => {
    fc.assert(
      fc.property(markdown, (source) => {
        for (const unit of scanBlocks(source).units) {
          if (unit.interrupting || (unit.start > 0 && source.charCodeAt(unit.start) === BYTE_ORDER_MARK)) continue;
          const alone = scanBlocks(source.slice(unit.start, unit.end)).units;
          expect(alone.map(({ node }) => node)).toEqual([unit.node]);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("a unit opening with U+FEFF", () => {
  test("is text inside a document but a byte order mark alone, the one unit that scans differently on its own", () => {
    const source = "a\n\n\u{feff}b\n";
    const unit = scanBlocks(source).units[1];
    expect(unit?.node.type).toBe("paragraph");
    expect(scanBlocks(source.slice(unit?.start, unit?.end)).units.map(({ node }) => node.start)).toEqual([1]);
  });
});

describe("a unit opened on a line that interrupts a paragraph", () => {
  test("keeps the paragraph's list-item rules for the containers it opens, so it scans differently alone", () => {
    const { units } = scanBlocks("a\n>2) x\n");
    expect([units[1]?.interrupting, units[1]?.node.type === "blockquote" ? units[1].node.children[0]?.type : undefined]).toEqual([
      true,
      "paragraph",
    ]);
    expect(
      scanBlocks(">2) x\n").units.map(({ interrupting, node }) => [interrupting, node.type === "blockquote" ? node.children[0]?.type : undefined]),
    ).toEqual([[false, "list"]]);
  });

  test("is not reused from a cache entry made where it did not interrupt, or the reverse", () => {
    for (const [first, second] of [
      [">2) x\n", "a\n>2) x\n"],
      ["a\n>2) x\n", ">2) x\n"],
    ] as const) {
      const cache = createUnitCache();
      parseMarkdown(first, COMMONMARK, cache);
      expect(parseMarkdown(second, COMMONMARK, cache)).toEqual(parseMarkdown(second));
    }
  });
});

describe("parseMarkdown with a unit cache", () => {
  test("keeps a document's leading byte order mark and a later unit opening with U+FEFF apart, in either order", () => {
    for (const [first, second] of [
      ["\u{feff}# a\n", "x\n\n\u{feff}# a\n"],
      ["x\n\n\u{feff}# a\n", "\u{feff}# a\n"],
    ] as const) {
      const cache = createUnitCache();
      parseMarkdown(first, COMMONMARK, cache);
      expect(parseMarkdown(second, COMMONMARK, cache)).toEqual(parseMarkdown(second));
    }
  });

  test("gives the same document after a random edit as parsing without one", () => {
    fc.assert(
      fc.property(markdown, edit, (before, change) => {
        const cache = createUnitCache();
        parseMarkdown(before, COMMONMARK, cache);
        const after = applyEdit(before, change);
        expect(parseMarkdown(after, COMMONMARK, cache)).toEqual(parseMarkdown(after));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  test("re-parses exactly the units whose link or footnote lookups a new definition changes", () => {
    const { cache, parsed } = createLoggingCache();
    const before = "[a] here\n\n[b] there\n\nx[^n]\n\nplain\n";
    parseMarkdown(before, COMMONMARK, cache);
    parsed.length = 0;
    parseMarkdown(before + "\n[a]: /u\n\n[^n]: note\n", COMMONMARK, cache);
    expect(parsed).toEqual(["[a] here\n\n", "x[^n]\n\n", "plain\n\n", "[a]: /u\n\n", "[^n]: note\n"]);
  });

  test("reuses a hit's node itself, so a caller can key per-unit data by node", () => {
    const cache = createUnitCache();
    const first = parseMarkdown("# a\n\nb\n", COMMONMARK, cache);
    const second = parseMarkdown("intro\n\n# a\n\nb\n", COMMONMARK, cache);
    expect(second.units[1]?.node).toBe(first.units[0]?.node);
  });

  test("evicts the oldest entry past its limit", () => {
    const cache = createUnitCache(2);
    parseMarkdown("a\n\nb\n\nc\n", COMMONMARK, cache);
    expect(["a\n\n", "b\n\n", "c\n"].map((text) => cache.get(text) !== undefined)).toEqual([false, true, true]);
  });
});

function dialectBlocks(md: string) {
  return shapeOf(parseDialect(md)).children;
}

function dialectInlines(md: string) {
  const [first] = dialectBlocks(md);
  if (first?.type !== "paragraph") throw new Error(`expected a paragraph, got ${first?.type}`);
  return first.children;
}

function nodeTypes(md: string): string[] {
  const types: string[] = [];
  walkMarkdown(parseDialect(md), (node) => {
    types.push(node.type);
    return undefined;
  });
  return types;
}

describe("parseMarkdown — CommonMark and GFM", () => {
  test("parses a GFM table into rows of cells", () => {
    expect(dialectBlocks("| a | b |\n|---|---|\n| 1 | 2 |")).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "a" }] },
              { type: "tableCell", children: [{ type: "text", value: "b" }] },
            ],
          },
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "1" }] },
              { type: "tableCell", children: [{ type: "text", value: "2" }] },
            ],
          },
        ],
      },
    ]);
  });

  test("parses ~~text~~ as strikethrough", () => {
    expect(dialectInlines("~~s~~")).toEqual([{ type: "delete", children: [{ type: "text", value: "s" }] }]);
  });

  test("keeps a single ~x~ as text", () => {
    expect(dialectInlines("~x~")).toEqual([{ type: "text", value: "~x~" }]);
  });

  test("autolinks a bare www. domain over http", () => {
    expect(dialectInlines("www.x.com")).toEqual([
      { type: "link", title: null, url: "http://www.x.com", children: [{ type: "text", value: "www.x.com" }] },
    ]);
  });

  test("parses a footnote reference and its definition", () => {
    expect(dialectBlocks("a[^1]\n\n[^1]: n")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "a" },
          { type: "footnoteReference", identifier: "1" },
        ],
      },
      { type: "footnoteDefinition", identifier: "1", children: [{ type: "paragraph", children: [{ type: "text", value: "n" }] }] },
    ]);
  });

  test("marks - [ ] items unchecked and - [x] items checked", () => {
    const [list] = dialectBlocks("- [ ] a\n- [x] b");
    if (list?.type !== "list") throw new Error("expected a list");
    expect((list.children ?? []).map((item) => item.checked)).toEqual([false, true]);
  });

  test("reads two dollar amounts as plain text", () => {
    expect(dialectInlines("it costs $5 and $6")).toEqual([{ type: "text", value: "it costs $5 and $6" }]);
  });

  test("reads a $$ fence as a paragraph", () => {
    expect(dialectBlocks("$$\nx\n$$")).toMatchObject([{ type: "paragraph", children: [{ type: "text", value: "$$\nx\n$$" }] }]);
  });
});

describe("parseMarkdown — raw HTML is text", () => {
  test("keeps an HTML block as literal paragraph text", () => {
    expect(dialectBlocks("<div>x</div>")).toEqual([{ type: "paragraph", children: [{ type: "text", value: "<div>x</div>" }] }]);
  });

  test("keeps inline HTML as literal text", () => {
    expect(dialectInlines("a <b>c</b>")).toEqual([{ type: "text", value: "a <b>c</b>" }]);
  });

  test("still parses an <https://…> autolink", () => {
    expect(dialectInlines("<https://a.b>")).toEqual([
      { type: "link", title: null, url: "https://a.b", children: [{ type: "text", value: "https://a.b" }] },
    ]);
  });

  test("never yields an html node from arbitrary markdown", () => {
    fc.assert(
      fc.property(mixedMarkdown, (md) => !nodeTypes(md).includes("html")),
      { numRuns: 2000 },
    );
  });
});

describe("parseMarkdown — dialect nodes out of context are text", () => {
  test("keeps a #tag inside link text as text", () => {
    expect(dialectInlines("[#tag](u)")).toEqual([{ type: "link", title: null, url: "u", children: [{ type: "text", value: "#tag" }] }]);
  });

  test("keeps a [[wiki link]] inside link text as text", () => {
    expect(dialectInlines("[[[x]]](u)")).toEqual([{ type: "link", title: null, url: "u", children: [{ type: "text", value: "[[x]]" }] }]);
  });

  test("keeps a #tag inside a reference link as text", () => {
    expect(dialectInlines("[#t][r]\n\n[r]: /u")).toEqual([
      { type: "linkReference", identifier: "r", referenceType: "full", children: [{ type: "text", value: "#t" }] },
    ]);
  });

  test("keeps the source text of an unwrapped tag when the page starts with a BOM", () => {
    expect(dialectInlines("\uFEFF[#t](u)")).toEqual([{ type: "link", title: null, url: "u", children: [{ type: "text", value: "#t" }] }]);
  });

  test("keeps a tag's text in an image's alt", () => {
    expect(dialectInlines("![a #t b](u)")).toEqual([{ type: "image", title: null, url: "u", alt: "a #t b" }]);
  });

  test("keeps a wiki link's text in an image's alt", () => {
    expect(dialectInlines("![see [[x]]](u)")).toEqual([{ type: "image", title: null, url: "u", alt: "see [[x]]" }]);
  });

  test("keeps due: outside any list as text", () => {
    expect(dialectInlines("due:2026-10-01")).toEqual([{ type: "text", value: "due:2026-10-01" }]);
  });

  test("keeps a due date that is not a calendar date as text", () => {
    expect(dialectBlocks("- [ ] a due:2026-02-30")).toEqual([
      {
        type: "list",
        ordered: false,
        start: null,
        spread: false,
        children: [
          {
            type: "listItem",
            spread: false,
            checked: false,
            children: [{ type: "paragraph", children: [{ type: "text", value: "a due:2026-02-30" }] }],
          },
        ],
      },
    ]);
  });

  test("keeps a due date in a plain list item as text", () => {
    expect(dialectBlocks("- a due:2026-10-01")).toEqual([
      {
        type: "list",
        ordered: false,
        start: null,
        spread: false,
        children: [
          {
            type: "listItem",
            spread: false,
            checked: null,
            children: [{ type: "paragraph", children: [{ type: "text", value: "a due:2026-10-01" }] }],
          },
        ],
      },
    ]);
  });
});
