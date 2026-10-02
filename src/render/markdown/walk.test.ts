import { describe, expect, test } from "bun:test";

import { parseDialect } from "./dialect.fixture";
import type { MarkdownNode, MarkdownParagraph, WalkNode } from "./types";
import { markdownChildren, walkMarkdown, walkTree } from "./walk";

interface Named extends WalkNode {
  type: string;
  children?: Named[];
}

const TREE: Named = {
  type: "a",
  children: [{ type: "b", children: [{ type: "c" }, { type: "d" }] }, { type: "e", children: [{ type: "f" }] }, { type: "g" }],
};

function trace(root: Named, skip: string[] = []): string[] {
  const events: string[] = [];
  walkTree<Named>(
    root,
    (node, ancestors) => {
      events.push(`enter ${node.type} [${ancestors.map(({ type }) => type).join("")}]`);
      return !skip.includes(node.type);
    },
    (node, ancestors) => {
      events.push(`leave ${node.type} [${ancestors.map(({ type }) => type).join("")}]`);
    },
  );
  return events;
}

describe("walkTree", () => {
  test("enters each node before its children and leaves it after them, in document order, with the path above it", () => {
    expect(trace(TREE)).toEqual([
      "enter a []",
      "enter b [a]",
      "enter c [ab]",
      "leave c [ab]",
      "enter d [ab]",
      "leave d [ab]",
      "leave b [a]",
      "enter e [a]",
      "enter f [ae]",
      "leave f [ae]",
      "leave e [a]",
      "enter g [a]",
      "leave g [a]",
      "leave a []",
    ]);
  });

  test("skips the children of a node whose enter returns false, and still leaves it", () => {
    expect(trace(TREE, ["b"])).toEqual([
      "enter a []",
      "enter b [a]",
      "leave b [a]",
      "enter e [a]",
      "enter f [ae]",
      "leave f [ae]",
      "leave e [a]",
      "enter g [a]",
      "leave g [a]",
      "leave a []",
    ]);
  });

  test("skips everything below a root whose enter returns false", () => {
    expect(trace(TREE, ["a"])).toEqual(["enter a []", "leave a []"]);
  });

  test("visits a chain 100,000 nodes deep without overflowing the call stack", () => {
    const root: Named = { type: "n" };
    let tip = root;
    for (let depth = 1; depth < 100_000; depth++) {
      const child: Named = { type: "n" };
      tip.children = [child];
      tip = child;
    }
    let entered = 0;
    let deepest = 0;
    walkTree<Named>(root, (_, ancestors) => {
      entered++;
      deepest = Math.max(deepest, ancestors.length);
    });
    expect([entered, deepest]).toEqual([100_000, 99_999]);
  });

  test("walks the engine's own nodes", () => {
    const paragraph: MarkdownParagraph = {
      type: "paragraph",
      start: 0,
      end: 7,
      segments: [0, 7, 0],
      children: [
        { type: "emphasis", start: 0, end: 3, children: [{ type: "text", start: 1, end: 2, value: "a" }] },
        { type: "text", start: 3, end: 7, value: " b c" },
      ],
    };
    const types: string[] = [];
    walkTree<MarkdownNode>(paragraph, (node) => {
      types.push(node.type);
      return undefined;
    });
    expect(types).toEqual(["paragraph", "emphasis", "text", "text"]);
  });
});

describe("walkMarkdown", () => {
  function visits(markdown: string, skip?: string): string[] {
    const seen: string[] = [];
    walkMarkdown(parseDialect(markdown), (node, { ancestors }) => {
      seen.push(`${"  ".repeat(ancestors.length)}${node.type}`);
      return node.type === skip ? false : undefined;
    });
    return seen;
  }

  test("visits each unit's nodes depth first, in document order", () => {
    expect(visits("# *a*\n\n- b\n- c")).toEqual([
      "heading",
      "  emphasis",
      "    text",
      "listItem",
      "  paragraph",
      "    text",
      "listItem",
      "  paragraph",
      "    text",
    ]);
  });

  test("skips a node's children when enter answers false", () => {
    expect(visits("*a* b\n\nc", "emphasis")).toEqual(["paragraph", "  emphasis", "  text", "paragraph", "  text"]);
  });

  test("visits a callout's title before its body", () => {
    expect(visits("> [!note] T\n> body")).toEqual(["callout", "  text", "  paragraph", "    text"]);
  });

  test("gives each node the offset of the unit its span is relative to", () => {
    const starts: number[] = [];
    walkMarkdown(parseDialect("a\n\n#t"), (node, { base }) => {
      if (node.type === "tag" || node.type === "text") starts.push(base + node.start);
      return undefined;
    });
    expect(starts).toEqual([0, 3]);
  });
});

describe("markdownChildren", () => {
  test("treats an image's description as its alt text, not as children", () => {
    const [unit] = parseDialect("![a *b*](u)").units;
    const image = unit?.node.type === "paragraph" ? unit.node.children[0] : undefined;
    expect(image === undefined ? null : markdownChildren(image)).toEqual([]);
  });

  test("answers no children for a leaf", () => {
    expect(markdownChildren({ type: "text", value: "x", start: 0, end: 1 })).toEqual([]);
  });
});
