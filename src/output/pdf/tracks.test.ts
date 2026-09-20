import { describe, expect, test } from "bun:test";

import { COLUMN_GUTTER, MARGIN, PAGE_WIDTH, ROW_COLUMNS } from "./geometry";
import { resolveTracks, spanOf, trackOffsets } from "./tracks";

describe("resolveTracks", () => {
  test("gives a fixed track exactly the points it asked for", () => {
    expect(resolveTracks([{ points: 120 }, { points: 80 }], 400, 0)).toEqual([120, 80]);
  });

  test("divides what is left between the shares, in proportion", () => {
    expect(resolveTracks([1, 1], 400, 0)).toEqual([200, 200]);
    expect(resolveTracks([3, 1], 400, 0)).toEqual([300, 100]);
  });

  test("takes the fixed tracks out before dividing, so a share is a share of the remainder", () => {
    expect(resolveTracks([{ points: 100 }, 1, 1], 400, 0)).toEqual([100, 150, 150]);
  });

  test("takes every gap out of the measure, never out of the last track", () => {
    expect(resolveTracks([1, 1], 410, 10)).toEqual([200, 200]);
  });

  test("gives a row of fixed tracks nothing to divide, and overflows rather than shrinking one", () => {
    expect(resolveTracks([{ points: 300 }, { points: 300 }], 400, 0)).toEqual([300, 300]);
  });

  test("resolves an empty row to no tracks at all", () => {
    expect(resolveTracks([], 400, 10)).toEqual([]);
  });
});

describe("the twelve-column grid is the track model, not a second one", () => {
  const widths = resolveTracks(
    Array.from({ length: ROW_COLUMNS }, () => 1),
    PAGE_WIDTH - MARGIN * 2,
    COLUMN_GUTTER,
  );
  const offsets = trackOffsets(widths, COLUMN_GUTTER);

  test("resolves to the same column width the printed grid is set on", () => {
    expect(widths[0]).toBeCloseTo((PAGE_WIDTH - MARGIN * 2 - COLUMN_GUTTER * (ROW_COLUMNS - 1)) / ROW_COLUMNS, 9);
  });

  test("starts the first column at the row's left edge and ends the last on its right", () => {
    expect(offsets[0]).toBe(0);
    expect(spanOf(widths, 0, ROW_COLUMNS, COLUMN_GUTTER)).toBeCloseTo(PAGE_WIDTH - MARGIN * 2, 9);
  });

  test("leaves exactly one gap between the end of a span and the track that follows it", () => {
    expect((offsets[3] ?? 0) - spanOf(widths, 0, 3, COLUMN_GUTTER)).toBeCloseTo(COLUMN_GUTTER, 9);
  });
});

describe("no flex vocabulary reaches the layout", () => {
  test("a track is a number or a points object, and carries no grow, shrink or basis", () => {
    const track: unknown = { points: 10 };
    expect(Object.keys(track as object)).toEqual(["points"]);
  });
});
