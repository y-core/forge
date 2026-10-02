import { describe, expect, test } from "bun:test";

import { MAX_DESTINATION_PARENS, MAX_LABEL_LENGTH } from "./definition";
import { parseInline } from "./inline";
import { parseMarkdown, renderMarkdownHtml } from "./mod";
import type { MarkdownInline, MarkdownParagraph } from "./mod";
import { SPEC_SCHEMA } from "./spec-schema.fixture";
import { COMMONMARK } from "./syntax";

function inlines(text: string, isDefined: (label: string) => boolean = () => false): MarkdownInline[] {
  const leaf: MarkdownParagraph = { type: "paragraph", start: 0, end: text.length, segments: [0, text.length, 0], children: [] };
  return parseInline(text, 0, leaf.segments, {
    isDefined,
    isFootnoteDefined: () => false,
    tableCell: false,
    syntax: COMMONMARK,
    leaf,
    leafIndex: 0,
    container: null,
  });
}

function render(markdown: string): string {
  return renderMarkdownHtml(parseMarkdown(markdown), { schema: SPEC_SCHEMA });
}

const nested = (depth: number) => "(".repeat(depth) + "x" + ")".repeat(depth);

describe("link label lookahead", () => {
  test("looks a full reference label up only while it is at most 999 characters", () => {
    const asked: string[] = [];
    inlines(`[x][${"a".repeat(MAX_LABEL_LENGTH)}] [y][${"b".repeat(MAX_LABEL_LENGTH + 1)}]`, (label) => {
      asked.push(label);
      return false;
    });
    expect(asked).toContain("A".repeat(MAX_LABEL_LENGTH));
    expect(asked.every((label) => label.length <= MAX_LABEL_LENGTH)).toBe(true);
  });

  test("looks link text up as a shortcut label only while it is at most 999 characters", () => {
    const asked: number[] = [];
    inlines(`[${"a".repeat(MAX_LABEL_LENGTH)}] [${"b".repeat(MAX_LABEL_LENGTH + 1)}]`, (label) => {
      asked.push(label.length);
      return false;
    });
    expect(asked).toEqual([MAX_LABEL_LENGTH]);
  });
});

describe("destination parenthesis depth", () => {
  test(`links through ${MAX_DESTINATION_PARENS} nested parentheses and leaves ${MAX_DESTINATION_PARENS + 1} as text`, () => {
    expect(inlines(`[a](${nested(MAX_DESTINATION_PARENS)})`)).toMatchObject([{ type: "link", url: nested(MAX_DESTINATION_PARENS) }]);
    expect(inlines(`[a](${nested(MAX_DESTINATION_PARENS + 1)})`).some((node) => node.type === "link")).toBe(false);
  });
});

describe("character reference lookahead", () => {
  test("decodes up to 7 decimal and 6 hexadecimal digits and leaves longer ones as text", () => {
    expect(inlines("&#1114112;&#x10FFFD;")).toEqual([{ type: "text", start: 0, end: 20, value: "\u{fffd}\u{10fffd}" }]);
    expect(inlines("&#11141110;&#x10FFFF0;")).toEqual([{ type: "text", start: 0, end: 22, value: "&#11141110;&#x10FFFF0;" }]);
  });

  test("leaves a name longer than any HTML entity as text without scanning on to its end", () => {
    const name = "a".repeat(33);
    expect(inlines(`&${name};`)).toEqual([{ type: "text", start: 0, end: 35, value: `&${name};` }]);
  });
});

describe("reference expansion", () => {
  test("renders references as their text once their URLs would pass max(64 KiB, twice the source)", () => {
    const url = "/" + "u".repeat(30 * 1024);
    const source = `[r]: ${url}\n\n${"[r] ".repeat(20)}\n`;
    const budget = Math.max(64 * 1024, 2 * source.length);
    const links = render(source).split("<a ").length - 1;
    expect(links).toBe(Math.floor(budget / url.length));
  });
});

describe("offsets", () => {
  test("place every node at its source span relative to the unit, across a block quote's markers", () => {
    const { units } = parseMarkdown("> *a*\n> [b](c)\n");
    const node = units[0]?.node;
    const paragraph = node?.type === "blockquote" ? node.children[0] : undefined;
    expect(paragraph?.type === "paragraph" ? paragraph.children : []).toMatchObject([
      { type: "emphasis", start: 2, end: 5 },
      { type: "text", start: 5, end: 8, value: "\n" },
      { type: "link", start: 8, end: 14 },
    ]);
  });
});

// CommonMark turns each line ending in a code span into a space before stripping one space from each end, and `\r\n` is one ending.
describe("code span line endings", () => {
  for (const [name, ending] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ] as const) {
    test(`strips a leading and a trailing ${name} as one space each`, () => {
      expect(render(`\`${ending}a${ending}\``)).toBe("<p><code>a</code></p>");
    });
  }
});
