import { describe, expect, test } from "bun:test";

import { KeepTogether, Text } from "./components";
import { createCursor } from "./cursor";
import { place } from "./elements";
import { LINE, MARGIN, PAGE_WIDTH } from "./geometry";
import { DEFAULT_ORPHANS, DEFAULT_WIDOWS } from "./limits";
import { pdfContentBox, resolvePdfPage } from "./page";
import type { PdfBox, PdfElement, PdfTextNode } from "./types";

const PAPER = resolvePdfPage();
const CONTENT = pdfContentBox(PAPER);
const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: CONTENT.bottom - CONTENT.top };

// Lays `element` out with only `room` points left on the page, which is what puts the break inside it.
function pagesOf(element: PdfElement, room: number, limits: { orphans?: number; widows?: number }): PdfTextNode[][] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  cursor.y = CONTENT.bottom - room;
  place(cursor, element, MEASURE, limits);
  return cursor.pages.map((page) => page.nodes.filter((node) => node.kind === "text"));
}

function lines(count: number): PdfElement {
  return Text({ children: Array.from({ length: count }, (_value, at) => `line${at}`).join("\n") });
}

describe("orphans and widows are applied at the split index", () => {
  test("a break that would strand fewer than `orphans` lines moves the whole run instead", () => {
    const [first, second] = pagesOf(lines(6), LINE * 1.5, { orphans: 2, widows: 0 });
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(6);
  });

  test("a break with room for the orphan limit keeps those lines where they are", () => {
    const [first, second] = pagesOf(lines(6), LINE * 3.5, { orphans: 2, widows: 0 });
    expect(first?.length).toBeGreaterThanOrEqual(2);
    expect(second?.length).toBeGreaterThan(0);
  });

  test("a break that would carry fewer than `widows` lines carries more of them", () => {
    const [, second] = pagesOf(lines(6), LINE * 5.5, { orphans: 0, widows: 2 });
    expect(second?.length).toBeGreaterThanOrEqual(2);
  });

  test("with no limits, the break falls exactly where the room runs out", () => {
    const [first] = pagesOf(lines(6), LINE * 3.5, {});
    expect(first).toHaveLength(3);
  });

  test("the defaults are the ones a renderer applies", () => {
    expect(DEFAULT_ORPHANS).toBe(2);
    expect(DEFAULT_WIDOWS).toBe(2);
  });
});

describe("KeepTogether moves a subtree whole", () => {
  test("a group that fits on a fresh page is moved rather than split", () => {
    const group = KeepTogether({ children: [Text({ children: "one" }), Text({ children: "two" }), Text({ children: "three" })] });
    const [first, second] = pagesOf(group, LINE * 1.5, {});
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(3);
  });
});
