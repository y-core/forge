import { describe, expect, test } from "bun:test";

import fc from "fast-check";

import spec from "../../../tests/fixtures/markdown/spec.json";
import { blockMarkdown, markdownEdit, mixedMarkdown } from "./arbitraries.fixture";
import { MAX_CONTAINER_DEPTH } from "./block";
import { parseMarkdown, renderMarkdownHtml, rescanUnitBounds, scanBlocks } from "./mod";
import type { MarkdownBlock, MarkdownDocument, MarkdownListInfo, MarkdownSegments, MarkdownUnitBounds } from "./mod";
import { atSize, PATHOLOGICAL_SHAPES } from "./pathological.fixture";
import { hasHtmlBlockStart } from "./raw-html.fixture";
import { SPEC_SCHEMA } from "./spec-schema.fixture";

const BLOCK_TAG = /<(\/?)(p|h[1-6]|hr|blockquote|ul|ol|li|pre)(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const START_ATTRIBUTE = /\bstart="(\d+)"/;
const LANGUAGE_CLASS = /<code class="language-([^"]*)">/;
const INLINE_TAG = /<[^>]*>/g;

function decodeHtml(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

function expectedSkeleton(html: string): string[] {
  const out: string[] = [];
  BLOCK_TAG.lastIndex = 0;
  for (let match = BLOCK_TAG.exec(html); match !== null; match = BLOCK_TAG.exec(html)) {
    const [whole, closing, tag = "", attributes = ""] = match;
    if (tag === "pre" && closing === "") {
      const close = html.indexOf("</pre>", match.index);
      const inner = html.slice(match.index + whole.length, close);
      const language = LANGUAGE_CLASS.exec(inner)?.[1];
      out.push(`<pre${language === undefined ? "" : ` ${decodeHtml(language)}`}>${decodeHtml(inner.replace(INLINE_TAG, ""))}`);
      BLOCK_TAG.lastIndex = close + "</pre>".length;
      continue;
    }
    const start = tag === "ol" && closing === "" ? START_ATTRIBUTE.exec(attributes)?.[1] : undefined;
    if (tag === "hr") out.push("<hr>");
    else out.push(`<${closing}${tag}${start === undefined || start === "1" ? "" : ` ${start}`}>`);
  }
  return out;
}

function leafText(source: string, base: number, segments: MarkdownSegments): string {
  let text = "";
  for (let index = 0; index < segments.length; index += 3) {
    const start = (segments[index] ?? 0) + base;
    const end = (segments[index + 1] ?? 0) + base;
    text += " ".repeat(segments[index + 2] ?? 0) + source.slice(start, end).replaceAll("\u0000", "\u{fffd}") + "\n";
  }
  return text;
}

function blockSkeleton(source: string, base: number, node: MarkdownBlock, tight: boolean, out: string[]): void {
  switch (node.type) {
    case "paragraph":
      if (!tight) out.push("<p>", "</p>");
      return;
    case "heading":
      out.push(`<h${node.depth}>`, `</h${node.depth}>`);
      return;
    case "thematicBreak":
      out.push("<hr>");
      return;
    case "code":
      out.push(`<pre${node.lang === null ? "" : ` ${node.lang}`}>${leafText(source, base, node.segments)}`);
      return;
    case "blockquote":
      out.push("<blockquote>");
      for (const child of node.children) blockSkeleton(source, base, child, false, out);
      out.push("</blockquote>");
      return;
    case "list":
      listSkeleton(
        source,
        node,
        node.children.map((item) => ({ base, node: item })),
        out,
      );
      return;
    case "listItem":
      out.push("<li>");
      for (const child of node.children) blockSkeleton(source, base, child, tight, out);
      out.push("</li>");
      return;
    default:
      return;
  }
}

function listSkeleton(source: string, list: MarkdownListInfo, items: { base: number; node: MarkdownBlock }[], out: string[]): void {
  const tag = list.ordered ? "ol" : "ul";
  out.push(`<${tag}${list.ordered && list.firstNumber !== 1 ? ` ${list.firstNumber}` : ""}>`);
  for (const item of items) blockSkeleton(source, item.base, item.node, !list.spread, out);
  out.push(`</${tag}>`);
}

function documentSkeleton(document: MarkdownDocument): string[] {
  const out: string[] = [];
  const { units, source } = document;
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    if (unit === undefined) continue;
    const list = unit.list;
    if (list === undefined) {
      blockSkeleton(source, unit.start, unit.node, false, out);
      continue;
    }
    const items: { base: number; node: MarkdownBlock }[] = [];
    while (units[index]?.list === list) {
      const item = units[index];
      if (item !== undefined) items.push({ base: item.start, node: item.node });
      index++;
    }
    index--;
    listSkeleton(source, list, items, out);
  }
  return out;
}

const BLOCK_EXAMPLES = spec.examples.filter(({ markdown }) => !hasHtmlBlockStart(markdown));

describe("scanBlocks against the CommonMark spec", () => {
  for (const { example, section, markdown, html } of BLOCK_EXAMPLES) {
    test(`example ${example} (${section}) has the expected block structure`, () => {
      expect(documentSkeleton(scanBlocks(markdown))).toEqual(expectedSkeleton(html));
    });
  }
});

describe("scanBlocks units", () => {
  const corpus = [...spec.examples.map(({ markdown }) => markdown), ...PATHOLOGICAL_SHAPES.map((shape) => atSize(shape, 4096))];

  test("cover the source end to end, so joining every unit's text returns it byte for byte", () => {
    for (const source of corpus) {
      const { units } = scanBlocks(source);
      const joined = units.map(({ start, end }) => source.slice(start, end)).join("");
      expect(units.length === 0 ? "" : joined).toBe(units.length === 0 ? "" : source);
      for (let index = 1; index < units.length; index++) expect(units[index]?.start).toBe(units[index - 1]?.end);
    }
  });

  test("start each unit at the start of a line, the first at offset 0", () => {
    for (const source of corpus) {
      const { units, lineStarts } = scanBlocks(source);
      expect(units[0]?.start ?? 0).toBe(0);
      for (const unit of units) expect(lineStarts).toContain(unit.start);
    }
  });

  test("split a top-level list into one unit per item, sharing the list's record", () => {
    const { units } = scanBlocks("1. a\n2. b\n\n3. c\n\npara\n");
    expect(units.map(({ node }) => node.type)).toEqual(["listItem", "listItem", "listItem", "paragraph"]);
    expect(units[0]?.list).toBe(units[2]?.list as MarkdownListInfo);
    expect(units[0]?.list).toEqual({ ordered: true, firstNumber: 1, spread: true });
  });

  test("keep a leading byte order mark inside the first unit at offset 0", () => {
    const { units } = scanBlocks("\u{feff}# a\n");
    expect(units).toHaveLength(1);
    expect(units[0]?.start).toBe(0);
    expect(units[0]?.node).toMatchObject({ type: "heading", start: 1 });
  });

  test("number each unit's line from 1", () => {
    expect(scanBlocks("a\n\n- b\n- c\n\n> d\n").units.map(({ line }) => line)).toEqual([1, 3, 4, 6]);
  });
});

describe("scanBlocks definitions", () => {
  test("register the first definition of a label and leave every definition in the tree", () => {
    const { units, definitions } = scanBlocks('[Foo]: /a "t"\n[foo]: /b\n\npara\n');
    expect([...definitions]).toEqual([["FOO", { url: "/a", title: "t" }]]);
    expect(units.map(({ node }) => node.type)).toEqual(["definition", "definition", "paragraph"]);
  });

  test("resolve escapes and character references in a destination and title", () => {
    expect(scanBlocks('[a]: /b\\*&amp; "c&quot;\\""\n').definitions.get("A")).toEqual({ url: "/b*&", title: 'c""' });
  });
});

describe("the container depth cap", () => {
  test(`nests block quotes ${MAX_CONTAINER_DEPTH} deep and reads the next marker as paragraph text`, () => {
    const { units, source } = scanBlocks("> ".repeat(MAX_CONTAINER_DEPTH + 1) + "a\n");
    let node: MarkdownBlock | undefined = units[0]?.node;
    let depth = 0;
    while (node?.type === "blockquote") {
      depth++;
      node = node.children[0];
    }
    expect(depth).toBe(MAX_CONTAINER_DEPTH);
    expect(node?.type).toBe("paragraph");
    const segments = node?.type === "paragraph" ? node.segments : [];
    expect(source.slice(segments[0], segments[1])).toBe("> a");
  });

  test("stops opening list items once a list and its item would pass the cap", () => {
    const { units } = scanBlocks("- ".repeat(MAX_CONTAINER_DEPTH) + "x\n");
    let containers = 2;
    let node: MarkdownBlock | undefined = units[0]?.node;
    while (node?.type === "listItem" || node?.type === "list") {
      node = node.children[0];
      if (node?.type === "listItem" || node?.type === "list") containers++;
    }
    expect(containers).toBe(MAX_CONTAINER_DEPTH);
  });
});

// A link reference definition is a leaf block, so it counts toward a list's looseness and its item's extent like any other.
describe("link reference definitions as blocks", () => {
  const render = (markdown: string) => renderMarkdownHtml(parseMarkdown(markdown), { schema: SPEC_SCHEMA });

  test("strips the indent of a paragraph line that follows a definition", () => {
    expect(render("[x]: /u\n  b")).toBe("<p>b</p>");
  });

  test("keeps a list tight when a definition spans an item's lines with no blank between", () => {
    expect(render("- [a]:\n  /u\n- b")).toBe("<ul>\n<li></li>\n<li>b</li>\n</ul>");
  });

  test("makes a list loose when a blank line separates a definition from the next block in an item", () => {
    expect(render("- [a]: /u\n\n  b")).toBe("<ul>\n<li>\n<p>b</p>\n</li>\n</ul>");
  });

  test("extends an item over every line of its definition", () => {
    const [unit] = parseMarkdown("- [a]:\n  /u\n- b").units;
    expect(unit?.node.end).toBe("- [a]:\n  /u".length);
  });
});

describe("scanBlocks neutrality", () => {
  test("marks a unit whose first line opens with no block left open", () => {
    expect(scanBlocks("a\n\n- b\n- c\n\n> d\n").units.map(({ neutral }) => neutral)).toEqual([true, true, false, false]);
  });

  test("leaves a unit after a paragraph line with no blank between unmarked", () => {
    expect(scanBlocks("a\n# b\n").units.map(({ neutral }) => neutral)).toEqual([true, false]);
  });

  test("leaves the first unit unmarked when a byte order mark is still to be skipped", () => {
    expect(scanBlocks("\u{feff}a\n\nb\n").units.map(({ neutral }) => neutral)).toEqual([false, true]);
  });
});

describe("rescanUnitBounds", () => {
  const boundsOf = (source: string): MarkdownUnitBounds[] => scanBlocks(source).units.map(({ start, end, neutral }) => ({ start, end, neutral }));

  test("returns the bounds scanBlocks gives the edited source", () => {
    fc.assert(
      fc.property(fc.oneof(blockMarkdown, mixedMarkdown), markdownEdit, (before, { at, remove, insert }) => {
        const start = Math.floor(at * before.length);
        const end = Math.min(before.length, start + remove);
        const after = before.slice(0, start) + insert + before.slice(end);
        expect(rescanUnitBounds(after, scanBlocks(before).units, start, end)).toEqual(boundsOf(after));
      }),
      { seed: 261004, numRuns: 2000 },
    );
  });

  test("closes the units after an edit that opens a fence, up to the source's end", () => {
    const before = "a\n\nb\n\nc\n";
    const after = "a\n\n```\nb\n\nc\n";
    expect(rescanUnitBounds(after, scanBlocks(before).units, 3, 3)).toEqual([
      { start: 0, end: 3, neutral: true },
      { start: 3, end: after.length, neutral: true },
    ]);
  });

  test("scans the whole source when the changed range does not fit the previous bounds", () => {
    const previous = scanBlocks("a\n\nb\n").units;
    for (const [start, end] of [
      [-1, 0],
      [2, 1],
      [0, 99],
    ] as const) {
      expect(rescanUnitBounds("x\n\ny\n\nz\n", previous, start, end)).toEqual(boundsOf("x\n\ny\n\nz\n"));
    }
  });

  test("scans the whole source when there are no previous bounds", () => {
    expect(rescanUnitBounds("x\n\ny\n", [], 0, 0)).toEqual(boundsOf("x\n\ny\n"));
  });
});
