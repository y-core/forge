import { describe, expect, test } from "bun:test";

import { parseDialect } from "./dialect.fixture";
import { defineMarkdownSyntax, parseMarkdown, renderMarkdownHtml } from "./mod";
import type { InlineAcceptContext, MarkdownExtensionBlock, MarkdownExtensionInline, InlineConstruct, MarkdownNode } from "./mod";
import { SPEC_SCHEMA } from "./spec-schema.fixture";
import { MAX_CONSTRUCT_LENGTH } from "./syntax";
import { shapeOf } from "./tree.fixture";
import { walkTree } from "./walk";

const AT = 0x40;
const PLUS = 0x2b;
const LETTER = /[a-z]/;

function mention(name: string): MarkdownExtensionInline {
  return { type: "mention", name } as unknown as MarkdownExtensionInline;
}

function createMention(accept?: InlineConstruct["accept"]): InlineConstruct {
  return {
    name: "mention",
    triggers: [AT],
    maxLength: 16,
    scan: (content, at, limit) => {
      let end = at + 1;
      while (end < limit && LETTER.test(content[end] ?? "")) end++;
      return end === at + 1 ? null : { end, node: mention(content.slice(at + 1, end)) };
    },
    accept,
  };
}

function types(markdown: string, syntax = defineMarkdownSyntax({ inline: [createMention()] })): string[] {
  const found: string[] = [];
  for (const unit of parseMarkdown(markdown, syntax).units) {
    walkTree<MarkdownNode>(unit.node, (node) => {
      found.push(node.type);
      return undefined;
    });
  }
  return found;
}

describe("inline constructs", () => {
  test("turn a trigger character's match into the construct's node, spanning its source", () => {
    const [unit] = parseMarkdown("hi @bob!\n", defineMarkdownSyntax({ inline: [createMention()] })).units;
    const children = unit?.node.type === "paragraph" ? unit.node.children : [];
    expect(children).toEqual([
      { type: "text", start: 0, end: 3, value: "hi " },
      { type: "mention", name: "bob", start: 3, end: 7 } as unknown as MarkdownExtensionInline,
      { type: "text", start: 7, end: 8, value: "!" },
    ]);
  });

  test("hand a scan a limit of maxLength past the trigger, and refuse a match that ends beyond it", () => {
    const limits: number[] = [];
    const greedy: InlineConstruct = {
      name: "greedy",
      triggers: [AT],
      maxLength: 4,
      scan: (content, at, limit) => {
        limits.push(limit - at);
        return { end: content.length + 1, node: mention("all") };
      },
    };
    expect(types("@abcdefgh\n", defineMarkdownSyntax({ inline: [greedy] }))).toEqual(["paragraph", "text"]);
    expect(limits).toEqual([4]);
  });

  test("give a scan only two code units before its trigger and maxLength from it, however far it tries to read", () => {
    const windows: string[] = [];
    const reader: InlineConstruct = {
      name: "reader",
      triggers: [AT],
      maxLength: 5,
      scan: (content, at) => {
        windows.push(`${content.slice(0, at)}|${content.slice(at)}`);
        return null;
      },
    };
    types("abcdef @ghijklmnop\n", defineMarkdownSyntax({ inline: [reader] }));
    expect(windows).toEqual(["f |@ghij"]);
  });

  test("let accept see whether the node sits in a link or an image, its leaf, and the leaf's container", () => {
    const seen: Omit<InlineAcceptContext, "leaf" | "container">[] = [];
    const containers: string[] = [];
    const construct = createMention((_node, context) => {
      seen.push({ inLink: context.inLink, inImage: context.inImage, leafIndex: context.leafIndex });
      containers.push(`${context.leaf.type} in ${context.container?.type ?? "unit"}`);
      return !context.inLink;
    });
    const syntax = defineMarkdownSyntax({ inline: [construct] });
    expect(types("> intro\n>\n> [@a](u) ![@b](u) @c\n", syntax)).toEqual([
      "blockquote",
      "paragraph",
      "text",
      "paragraph",
      "link",
      "text",
      "text",
      "image",
      "mention",
      "text",
      "mention",
    ]);
    expect(seen).toEqual([
      { inLink: true, inImage: false, leafIndex: 1 },
      { inLink: false, inImage: true, leafIndex: 1 },
      { inLink: false, inImage: false, leafIndex: 1 },
    ]);
    expect(new Set(containers)).toEqual(new Set(["paragraph in blockquote"]));
  });
});

describe("delimiter constructs", () => {
  const syntax = defineMarkdownSyntax({ delimiters: [{ char: PLUS, type: "ins" as MarkdownExtensionInline["type"] }] });

  test("wrap what an exact pair of runs encloses in the construct's node", () => {
    expect(types("a ++b *c*++ d\n", syntax)).toEqual(["paragraph", "text", "ins", "text", "emphasis", "text", "text"]);
  });

  test("leave a run of one or three as text", () => {
    expect(types("+a+ +++b+++\n", syntax)).toEqual(["paragraph", "text"]);
  });

  test("resolve crossing runs on the one delimiter stack, the first closer taking its nearest opener", () => {
    expect(types("~~a ++b~~ c++\n", syntax)).toEqual(["paragraph", "delete", "text", "text"]);
  });

  test("take effect for a character above U+007F, on a leaf of nothing else and inside a sentence", () => {
    const wide = defineMarkdownSyntax({ delimiters: [{ char: 0x2016, type: "ins" as MarkdownExtensionInline["type"] }] });
    expect(types("\u2016\u2016a\u2016\u2016\n", wide)).toEqual(["paragraph", "ins", "text"]);
    expect(types("x \u2016\u2016a\u2016\u2016 *y*\n", wide)).toEqual(["paragraph", "text", "ins", "text", "text", "emphasis", "text"]);
  });
});

describe("block transforms", () => {
  test("replace a finished block, reading its parsed inline content, and transform nested blocks of the same type", () => {
    const syntax = defineMarkdownSyntax({
      blocks: [
        {
          type: "blockquote",
          transform: (node, { text }) => {
            if (node.type !== "blockquote") return null;
            const first = node.children[0];
            const marked = first?.type === "paragraph" && first.children[0]?.type === "text" && text.startsWith("!", first.children[0].start);
            return marked
              ? ({ type: "aside", start: node.start, end: node.end, children: node.children } as unknown as MarkdownExtensionBlock)
              : null;
          },
        },
      ],
    });
    expect(types("> !a\n>\n> > !b\n>\n> > c\n", syntax)).toEqual([
      "aside",
      "paragraph",
      "text",
      "aside",
      "paragraph",
      "text",
      "blockquote",
      "paragraph",
      "text",
    ]);
  });
});

describe("rendering extension nodes", () => {
  test("render through a handler the caller supplies, and refuse a node type no handler covers", () => {
    const document = parseMarkdown("hi @bob\n", defineMarkdownSyntax({ inline: [createMention()] }));
    const handlers = {
      mention: {
        enter: (node: MarkdownNode, { writer }: { writer: { open: (tag: string) => void; text: (value: string) => void; close: () => void } }) => {
          writer.open("em");
          writer.text(`@${(node as unknown as { name: string }).name}`);
          writer.close();
        },
      },
    };
    expect(renderMarkdownHtml(document, { schema: SPEC_SCHEMA, handlers })).toBe("<p>hi <em>@bob</em></p>");
    expect(() => renderMarkdownHtml(document, { schema: SPEC_SCHEMA })).toThrow("renderMarkdownHtml: no handler for a `mention` node.");
  });
});

describe("defineMarkdownSyntax", () => {
  test("refuses a construct without triggers or with a maxLength outside 1 to MAX_CONSTRUCT_LENGTH, and a delimiter character already taken", () => {
    expect(() => defineMarkdownSyntax({ inline: [{ ...createMention(), triggers: [] }] })).toThrow("has no trigger characters");
    expect(() => defineMarkdownSyntax({ inline: [{ ...createMention(), maxLength: 0 }] })).toThrow("integer maxLength from 1 to 1024");
    expect(() => defineMarkdownSyntax({ inline: [{ ...createMention(), maxLength: MAX_CONSTRUCT_LENGTH + 1 }] })).toThrow(
      "integer maxLength from 1 to 1024",
    );
    expect(defineMarkdownSyntax({ inline: [{ ...createMention(), maxLength: MAX_CONSTRUCT_LENGTH }] }).triggers.size).toBe(1);
    expect(() => defineMarkdownSyntax({ delimiters: [{ char: 0x7e, type: "x" as MarkdownExtensionInline["type"] }] })).toThrow("already taken");
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

describe("highlights", () => {
  test("parses ==x==", () => {
    expect(dialectInlines("==x==")).toEqual([{ type: "highlight", children: [{ type: "text", value: "x" }] }]);
  });

  test("nests emphasis inside a highlight", () => {
    expect(dialectInlines("==*x*==")).toEqual([{ type: "highlight", children: [{ type: "emphasis", children: [{ type: "text", value: "x" }] }] }]);
  });

  test("nests a highlight inside strikethrough", () => {
    expect(dialectInlines("~~==x==~~")).toEqual([{ type: "delete", children: [{ type: "highlight", children: [{ type: "text", value: "x" }] }] }]);
  });

  test("parses two highlights on one line separately", () => {
    expect(dialectInlines("==x== ==y==")).toEqual([
      { type: "highlight", children: [{ type: "text", value: "x" }] },
      { type: "text", value: " " },
      { type: "highlight", children: [{ type: "text", value: "y" }] },
    ]);
  });

  test("keeps a line ending inside a highlight", () => {
    expect(dialectInlines("==a\nb==")).toEqual([{ type: "highlight", children: [{ type: "text", value: "a\nb" }] }]);
  });

  test("parses a highlight inside a table cell", () => {
    expect(dialectBlocks("| h |\n|---|\n| ==x== |")).toEqual([
      {
        type: "table",
        align: [null],
        children: [
          { type: "tableRow", children: [{ type: "tableCell", children: [{ type: "text", value: "h" }] }] },
          { type: "tableRow", children: [{ type: "tableCell", children: [{ type: "highlight", children: [{ type: "text", value: "x" }] }] }] },
        ],
      },
    ]);
  });
});

describe("highlights — not highlights", () => {
  test("keeps a == b surrounded by spaces as text", () => {
    expect(dialectInlines("a == b")).toEqual([{ type: "text", value: "a == b" }]);
  });

  test("keeps a single =x= as text", () => {
    expect(dialectInlines("=x=")).toEqual([{ type: "text", value: "=x=" }]);
  });

  test("keeps a triple ===x=== as text", () => {
    expect(dialectInlines("===x===")).toEqual([{ type: "text", value: "===x===" }]);
  });

  test("keeps an escaped \\==x== as text", () => {
    expect(dialectInlines("\\==x==")).toEqual([{ type: "text", value: "==x==" }]);
  });

  test("keeps an unclosed ==x as text", () => {
    expect(dialectInlines("==x")).toEqual([{ type: "text", value: "==x" }]);
  });

  test("reads == under a line as a setext heading", () => {
    expect(dialectBlocks("a\n==")).toEqual([{ type: "heading", depth: 1, children: [{ type: "text", value: "a" }] }]);
  });
});
