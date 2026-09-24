import { describe, expect, test } from "bun:test";

import { createCursor, letterheadTop } from "./cursor";
import { MARGIN, PAGE_HEIGHT } from "./geometry";
import { resolvePdfPage } from "./page";
import type { PdfArtwork, PdfLetterhead, PdfPathCommand } from "./types";

const MARK: PdfLetterhead = { name: "Meridian", tagline: "Practice", email: "a@b.example", phone: "+27 21 555 0143" };

// A square in a hundred-unit space, so a scale is legible as a coordinate rather than arithmetic.
// Three paths over two inks, the third repeating the second's, so coalescing is visible.
const SHAPE: readonly PdfPathCommand[] = [{ op: "move", x: 0, y: 0 }, { op: "line", x: 50, y: 0 }, { op: "close" }];
const ARTWORK: PdfArtwork = {
  width: 100,
  height: 100,
  paths: [
    { commands: SHAPE, fill: [1, 0, 0] },
    { commands: SHAPE, fill: [0, 1, 0] },
    { commands: SHAPE, fill: [0, 1, 0] },
  ],
};

describe("page breaks", () => {
  test("reserve opens a new page only when the run would cross the bottom margin", () => {
    const cursor = createCursor(undefined);
    cursor.newPage();
    cursor.reserve(10);
    expect(cursor.pages).toHaveLength(1);
    cursor.y = PAGE_HEIGHT - MARGIN - 5;
    cursor.reserve(10);
    expect(cursor.pages).toHaveLength(2);
    expect(cursor.y).toBe(MARGIN);
  });

  test("a page holding nothing but its letterhead reads as empty", () => {
    const cursor = createCursor(MARK);
    cursor.newPage();
    expect(cursor.empty).toBe(true);
    cursor.text("a line", 0, cursor.y, "regular", 10);
    expect(cursor.empty).toBe(false);
  });
});

describe("the letterhead", () => {
  test("repeats on every page it opens", () => {
    const cursor = createCursor(MARK);
    cursor.newPage();
    const first = cursor.pages[0]?.letterheadNodes ?? 0;
    cursor.newPage();
    expect(cursor.pages[1]?.letterheadNodes).toBe(first);
    expect(first).toBeGreaterThan(0);
  });

  test("leaves the baseline below the rule it draws, not at the page top", () => {
    const cursor = createCursor(MARK);
    cursor.newPage();
    expect(cursor.y).toBeGreaterThan(MARGIN);
  });

  test("rendered with no palette, emits no ink operator at all — the brand is the caller's", () => {
    const cursor = createCursor(MARK);
    cursor.newPage();
    expect((cursor.pages[0]?.nodes ?? []).filter((node) => node.kind === "ink")).toEqual([]);
  });

  test("takes the channel's ink for its type, and keeps the mark's own colours for the mark", () => {
    const cursor = createCursor({ ...MARK, mark: ARTWORK }, { channel: { letterhead: [0.1, 0.2, 0.3] } });
    cursor.newPage();
    const inks = (cursor.pages[0]?.nodes ?? []).filter((node) => node.kind === "ink").map((node) => node.ink);
    expect(inks).toContainEqual([1, 0, 0]);
    expect(inks).toContainEqual([0.1, 0.2, 0.3]);
  });

  test("states an ink once per run that shares it, and resets the channel once after the last path", () => {
    const cursor = createCursor({ ...MARK, mark: ARTWORK });
    cursor.newPage();
    const artwork = (cursor.pages[0]?.nodes ?? []).filter((node) => node.tag === "artwork");
    expect(artwork.map((node) => node.kind)).toEqual(["ink", "path", "ink", "path", "path", "ink"]);
    expect(artwork.filter((node) => node.kind === "ink").map((node) => node.ink)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
  });

  test("draws no artwork where the letterhead carries no mark, since forge holds none of its own", () => {
    const cursor = createCursor(MARK);
    cursor.newPage();
    expect((cursor.pages[0]?.nodes ?? []).filter((node) => node.tag === "artwork")).toEqual([]);
  });

  test("scales the mark out of its own coordinate space into the width it is drawn at", () => {
    const cursor = createCursor({ ...MARK, mark: ARTWORK, markWidth: 50 });
    cursor.newPage();
    const [drawn] = (cursor.pages[0]?.nodes ?? []).filter((node) => node.kind === "path" && node.tag === "artwork");
    const corner = drawn?.kind === "path" ? drawn.commands[1] : undefined;
    expect(corner).toMatchObject({ x: MARGIN + 25 });
  });
});

describe("the first baseline has one home", () => {
  test("letterheadTop is exactly where newPage leaves the cursor", () => {
    const cursor = createCursor(MARK);
    cursor.newPage();
    expect(cursor.y).toBe(letterheadTop(MARK));
  });

  test("and is the content top where the document carries no letterhead", () => {
    const cursor = createCursor(undefined);
    cursor.newPage();
    expect(cursor.y).toBe(letterheadTop(undefined));
    expect(letterheadTop(undefined)).toBe(MARGIN);
  });

  test("follows the paper's own top margin rather than a constant", () => {
    const paper = resolvePdfPage({ margin: { all: 100 } });
    const cursor = createCursor(MARK, { paper });
    cursor.newPage();
    expect(cursor.y).toBe(letterheadTop(MARK, paper));
    expect(letterheadTop(MARK, paper)).toBeGreaterThan(letterheadTop(MARK));
  });
});
