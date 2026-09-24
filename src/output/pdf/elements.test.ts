import { describe, expect, test } from "bun:test";

import { createCursor } from "./cursor";
import { place } from "./elements";
import { MARGIN, PAGE_WIDTH } from "./geometry";
import type { PdfBox, PdfCursor, PdfElement, PdfFragment } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

/** An element of `count` identical lines, each recording the page it was painted on. */
function lines(count: number, advance: number, painted: number[]): PdfElement {
  const fragments: PdfFragment[] = Array.from({ length: count }, () => ({
    reserve: advance,
    advance,
    paint(cursor: PdfCursor) {
      painted.push(cursor.pages.length);
      cursor.y += advance;
    },
  }));
  return { measure: () => ({ preferred: 0, minimum: 0, height: advance * count }), fragments: () => fragments };
}

/** Which page each fragment of `element` landed on, placed under `limits` in a box of `height`. */
function pagesOf(element: PdfElement, painted: number[], limits: Parameters<typeof place>[3] = {}, height = MEASURE.height): number[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  place(cursor, element, { ...MEASURE, height }, limits);
  return painted;
}

describe("placing an element that fits", () => {
  test("paints every fragment on the page it started on", () => {
    const painted: number[] = [];
    expect(pagesOf(lines(3, 10, painted), painted)).toEqual([1, 1, 1]);
  });

  test("advances the baseline by the height it measured", () => {
    const cursor = createCursor(undefined);
    cursor.newPage();
    const before = cursor.y;
    place(cursor, lines(4, 10, []), MEASURE);
    expect(cursor.y - before).toBeCloseTo(40, 9);
  });
});

// Deciding the split before anything is painted is what keeps a placement final: an orphan rule
// applied afterwards would have to undo one, and undone placements are unreproducible bugs.
describe("placing an element that does not fit", () => {
  // With no limit asked for, the box's height decides nothing: each fragment reserves against the
  // cursor's own page, which is what opens a page under a run longer than the paper.
  test("breaks against the page rather than the box where no limit is asked for", () => {
    const painted: number[] = [];
    expect(pagesOf(lines(5, 10, painted), painted, {}, 25)).toEqual([1, 1, 1, 1, 1]);
    const long: number[] = [];
    expect(new Set(pagesOf(lines(200, 20, long), long)).size).toBeGreaterThan(1);
  });

  test("keeps at least `widows` fragments together on the page that receives them", () => {
    const painted: number[] = [];
    expect(pagesOf(lines(5, 10, painted), painted, { widows: 3 }, 25)).toEqual([1, 1, 2, 2, 2]);
  });

  // The whole element moves rather than leaving a single line behind. At the very top of a page
  // there is nothing to move it off, so the rule correctly does nothing — hence the element before it.
  test("moves the whole element when the break would strand fewer than `orphans`", () => {
    const cursor = createCursor(undefined);
    cursor.newPage();
    place(cursor, lines(1, 10, []), MEASURE);
    const painted: number[] = [];
    place(cursor, lines(4, 10, painted), { ...MEASURE, height: 25 }, { orphans: 3 });
    expect(painted).toEqual([2, 2, 2, 2]);
  });

  test("leaves a break alone where both limits are already satisfied", () => {
    const painted: number[] = [];
    expect(pagesOf(lines(6, 10, painted), painted, { orphans: 2, widows: 2 }, 35)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  test("treats zero limits exactly as the default, so opting out is not its own path", () => {
    const stated: number[] = [];
    const omitted: number[] = [];
    expect(pagesOf(lines(5, 10, stated), stated, { orphans: 0, widows: 0 }, 25)).toEqual(pagesOf(lines(5, 10, omitted), omitted, {}, 25));
  });
});
