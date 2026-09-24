import { describe, expect, test } from "bun:test";

import { createCursor } from "./cursor";
import { BLACK_INK, MARGIN } from "./geometry";
import type { PdfNode } from "./types";

function nodesOf(draw: (cursor: ReturnType<typeof createCursor>) => void): PdfNode[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  draw(cursor);
  return cursor.pages[0]?.nodes ?? [];
}

describe("every node carries a structure tag", () => {
  test("a run emitted inside `tagged` takes that tag, and the one outside takes the default", () => {
    const nodes = nodesOf((cursor) => {
      cursor.text("outside", 0, 0, "regular", 10);
      cursor.tagged("heading", () => {
        cursor.text("inside", 0, 0, "bold", 12);
      });
      cursor.text("after", 0, 0, "regular", 10);
    });
    expect(nodes.map((node) => node.tag)).toEqual(["value", "heading", "value"]);
  });

  test("no node kind the cursor emits can be built without a tag", () => {
    const nodes = nodesOf((cursor) => {
      cursor.text("a", 1, 2, "regular", 10);
      cursor.rule(3);
      cursor.segment(1, 2, 3, 0.5);
      cursor.polyline(
        [
          [0, 0],
          [1, 1],
        ],
        1,
      );
      cursor.roundedRect(0, 0, 9, 2, 0.7);
      cursor.ink(BLACK_INK);
    });
    expect(nodes).toHaveLength(6);
    expect(nodes.every((node) => typeof node.tag === "string")).toBe(true);
  });
});

describe("geometry above the seam is absolute and measured downward", () => {
  test("a fresh page opens at the content top, not at a page coordinate", () => {
    const nodes = nodesOf((cursor) => {
      cursor.text("first", 0, cursor.y, "regular", 10);
    });
    expect(nodes[0]).toMatchObject({ kind: "text", y: MARGIN });
  });

  test("a rule spans the measure at the y it was given, with no layout left to resolve", () => {
    const [node] = nodesOf((cursor) => {
      cursor.rule(100);
    });
    expect(node).toMatchObject({
      kind: "path",
      commands: [
        { op: "move", y: 100 },
        { op: "line", y: 100 },
      ],
    });
  });
});

describe("paint state is a node, not an operator", () => {
  test("a painted run brackets the draw with a fill change and a reset to black", () => {
    const nodes = nodesOf((cursor) => {
      cursor.painted([1, 0, 0], () => {
        cursor.text("red", 0, 0, "regular", 10);
      });
    });
    expect(nodes.map((node) => node.kind)).toEqual(["ink", "text", "ink"]);
    expect(nodes.at(-1)).toMatchObject({ kind: "ink", channel: "fill", ink: BLACK_INK });
  });

  test("an unset ink emits no state change at all, rather than defaulting to black", () => {
    const nodes = nodesOf((cursor) => {
      cursor.painted(undefined, () => {
        cursor.text("plain", 0, 0, "regular", 10);
      });
      cursor.stroked(undefined, () => {
        cursor.rule(10);
      });
    });
    expect(nodes.map((node) => node.kind)).toEqual(["text", "path"]);
  });
});
