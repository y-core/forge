import { describe, expect, it } from "bun:test";

import { parseDialect } from "./dialect.fixture";
import { shapeOf } from "./tree.fixture";

function children(md: string) {
  return shapeOf(parseDialect(md)).children;
}

function paragraph(md: string) {
  const [first] = children(md);
  if (first?.type !== "paragraph") throw new Error(`expected a paragraph, got ${first?.type}`);
  return first.children;
}

describe("tags", () => {
  it("starts no tag right after an underscore or an ampersand, though other punctuation may precede one", () => {
    expect([paragraph("a _#t"), paragraph("a &#t"), paragraph("a -#t")]).toEqual([
      [{ type: "text", value: "a _#t" }],
      [{ type: "text", value: "a &#t" }],
      [
        { type: "text", value: "a -" },
        { type: "tag", name: "t" },
      ],
    ]);
  });

  it("parses #tag", () => {
    expect(paragraph("#tag")).toEqual([{ type: "tag", name: "tag" }]);
  });

  it("parses a nested #area/sub as one tag", () => {
    expect(paragraph("#area/sub")).toEqual([{ type: "tag", name: "area/sub" }]);
  });

  it("parses a tag of non-ASCII letters", () => {
    expect(paragraph("#Ünïcode")).toEqual([{ type: "tag", name: "Ünïcode" }]);
  });

  it("parses a tag after a word and a space", () => {
    expect(paragraph("see #finance")).toEqual([
      { type: "text", value: "see " },
      { type: "tag", name: "finance" },
    ]);
  });

  it("parses a tag inside parentheses", () => {
    expect(paragraph("(#t)")).toEqual([
      { type: "text", value: "(" },
      { type: "tag", name: "t" },
      { type: "text", value: ")" },
    ]);
  });

  it("parses a tag inside strong emphasis", () => {
    expect(paragraph("**#t**")).toEqual([{ type: "strong", children: [{ type: "tag", name: "t" }] }]);
  });

  it("parses a tag inside a heading", () => {
    expect(children("# Title #t")).toEqual([
      {
        type: "heading",
        depth: 1,
        children: [
          { type: "text", value: "Title " },
          { type: "tag", name: "t" },
        ],
      },
    ]);
  });

  it("keeps a decomposed combining accent inside the tag name", () => {
    expect(paragraph("#cafe\u0301")).toEqual([{ type: "tag", name: "cafe\u0301" }]);
  });

  it("parses #a-b_c as one tag", () => {
    expect(paragraph("#a-b_c")).toEqual([{ type: "tag", name: "a-b_c" }]);
  });

  it("ends a tag before a trailing slash", () => {
    expect(paragraph("#a/")).toEqual([
      { type: "tag", name: "a" },
      { type: "text", value: "/" },
    ]);
  });

  it("ends a tag before sentence punctuation", () => {
    expect(paragraph("#t.")).toEqual([
      { type: "tag", name: "t" },
      { type: "text", value: "." },
    ]);
  });
});

describe("tags — length", () => {
  it("stops a tag name at 1023 characters and keeps the rest as text", () => {
    expect(paragraph("#" + "a".repeat(1100))).toEqual([
      { type: "tag", name: "a".repeat(1023) },
      { type: "text", value: "a".repeat(77) },
    ]);
  });
});

describe("tags — not tags", () => {
  it("keeps a tag starting with a combining mark as text", () => {
    expect(paragraph("#\u0301a")).toEqual([{ type: "text", value: "#\u0301a" }]);
  });

  it("keeps #1 as text because a tag starts with a letter", () => {
    expect(paragraph("#1")).toEqual([{ type: "text", value: "#1" }]);
  });

  it("keeps a#b inside a word as text", () => {
    expect(paragraph("a#b")).toEqual([{ type: "text", value: "a#b" }]);
  });

  it("keeps x/#y after a slash as text", () => {
    expect(paragraph("x/#y")).toEqual([{ type: "text", value: "x/#y" }]);
  });

  it("keeps ##t after another # as text", () => {
    expect(paragraph("##t")).toEqual([{ type: "text", value: "##t" }]);
  });

  it("keeps an escaped \\#t as text", () => {
    expect(paragraph("\\#t")).toEqual([{ type: "text", value: "#t" }]);
  });

  it("keeps #t in inline code as code", () => {
    expect(paragraph("`#t`")).toEqual([{ type: "inlineCode", value: "#t" }]);
  });

  it("keeps #t in a fenced block as code", () => {
    expect(children("```\n#t\n```")).toEqual([{ type: "code", lang: null, meta: null, value: "#t" }]);
  });

  it("reads '# heading' as an ATX heading, not a tag", () => {
    expect(children("# heading")).toEqual([{ type: "heading", depth: 1, children: [{ type: "text", value: "heading" }] }]);
  });

  it("keeps an entity-encoded &#35;t as text", () => {
    expect(paragraph("&#35;t")).toEqual([{ type: "text", value: "#t" }]);
  });
});
