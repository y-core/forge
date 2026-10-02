import { describe, expect, test } from "bun:test";

import { parseDialect } from "./dialect.fixture";
import { parseMarkdown } from "./document";
import { defineMarkdownSyntax } from "./syntax";
import { shapeOf } from "./tree.fixture";
import { createWikiLinkConstruct } from "./wikilink";

function paragraph(md: string) {
  const [first] = shapeOf(parseDialect(md)).children;
  if (first?.type !== "paragraph") throw new Error(`expected a paragraph, got ${first?.type}`);
  return first.children;
}

describe("wiki links — targets", () => {
  test("keeps a [[target]] as its raw text", () => {
    expect(paragraph("[[Budget]]")).toEqual([{ type: "wikiLink", target: "Budget" }]);
  });

  test("keeps a [[target|label]] with its label", () => {
    expect(paragraph("[[Budget|the budget]]")).toEqual([{ type: "wikiLink", target: "Budget", label: "the budget" }]);
  });

  test("keeps the target untrimmed and in its written case, for the app to resolve", () => {
    expect(paragraph("[[ Mixed Case#Slug ]]")).toEqual([{ type: "wikiLink", target: " Mixed Case#Slug " }]);
  });

  test("keeps an empty label after a separator", () => {
    expect(paragraph("[[a|]]")).toEqual([{ type: "wikiLink", target: "a", label: "" }]);
  });

  test("ends the target at an escaped pipe and drops the escape", () => {
    expect(paragraph("[[a\\|b]]")).toEqual([{ type: "wikiLink", target: "a", label: "b" }]);
  });
});

describe("wiki links — embeds", () => {
  test("embeds ![[target|alt]] under the id embedId answers, with its alt", () => {
    expect(paragraph("![[att:ABC|a chart]]")).toEqual([{ type: "embed", id: "abc", alt: "a chart" }]);
  });

  test("embeds ![[target]] with no alt", () => {
    expect(paragraph("![[att:abc]]")).toEqual([{ type: "embed", id: "abc" }]);
  });

  test("keeps ![[target]] that embedId answers null for as text", () => {
    expect(paragraph("![[Title]]")).toEqual([{ type: "text", value: "![[Title]]" }]);
  });

  test("asks embedId nothing for a link without the !", () => {
    const asked: string[] = [];
    const syntax = defineMarkdownSyntax({ inline: [createWikiLinkConstruct({ embedId: (target) => (asked.push(target), target) })] });
    const [unit] = parseMarkdown("[[att:abc]] ![[x]]", syntax).units;
    expect(unit?.node.type === "paragraph" ? unit.node.children.map((node) => node.type) : []).toEqual(["wikiLink", "text", "embed"]);
    expect(asked).toEqual(["x"]);
  });

  test("keeps an embed inside link text, and drops one inside an image description to text", () => {
    expect(paragraph("[![[att:a]]](u)")).toEqual([{ type: "link", title: null, url: "u", children: [{ type: "embed", id: "a" }] }]);
    expect(paragraph("![![[att:a]]](u)")).toEqual([{ type: "image", title: null, url: "u", alt: "![[att:a]]" }]);
  });
});

describe("wiki links — not links", () => {
  test("keeps [[]] as text", () => {
    expect(paragraph("[[]]")).toEqual([{ type: "text", value: "[[]]" }]);
  });

  test("keeps [[a]b]] with a single closing bracket as text", () => {
    expect(paragraph("[[a]b]]")).toEqual([{ type: "text", value: "[[a]b]]" }]);
  });

  test("keeps a target broken by a line ending as text", () => {
    expect(paragraph("[[a\nb]]")).toEqual([{ type: "text", value: "[[a\nb]]" }]);
  });

  test("links a 999-character target", () => {
    const title = "a".repeat(999);
    expect(paragraph(`[[${title}]]`)).toEqual([{ type: "wikiLink", target: title }]);
  });

  test("keeps a 1000-character target as text", () => {
    const md = `[[${"a".repeat(1000)}]]`;
    expect(paragraph(md)).toEqual([{ type: "text", value: md }]);
  });

  test("keeps a target and label over 999 characters together as text", () => {
    const md = `[[${"a".repeat(500)}|${"b".repeat(500)}]]`;
    expect(paragraph(md)).toEqual([{ type: "text", value: md }]);
  });
});

describe("wiki links — interaction with CommonMark", () => {
  test("wins over a matching [x]: reference definition", () => {
    expect(shapeOf(parseDialect("[[x]]\n\n[x]: /u")).children).toEqual([
      { type: "paragraph", children: [{ type: "wikiLink", target: "x" }] },
      { type: "definition", identifier: "x", title: null, url: "/u" },
    ]);
  });

  test("keeps a labelled link in one table cell when its pipe is escaped", () => {
    expect(shapeOf(parseDialect(`| [[abc\\|L]] |\n|---|`)).children).toEqual([
      {
        type: "table",
        align: [null],
        children: [{ type: "tableRow", children: [{ type: "tableCell", children: [{ type: "wikiLink", target: "abc", label: "L" }] }] }],
      },
    ]);
  });

  test("splits a labelled link across two table cells when its pipe is bare", () => {
    expect(shapeOf(parseDialect(`| [[abc|L]] |\n|---|---|`)).children).toEqual([
      {
        type: "table",
        align: [null, null],
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: `[[abc` }] },
              { type: "tableCell", children: [{ type: "text", value: "L]]" }] },
            ],
          },
        ],
      },
    ]);
  });
});
