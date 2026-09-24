import { describe, expect, test } from "bun:test";

import { embeddedWidth } from "./measure";
import type { PdfEmbeddedMetrics } from "./types";

const METRICS: PdfEmbeddedMetrics = {
  unitsPerEm: 1000,
  ascent: 1193,
  descent: -289,
  bbox: [-100, -300, 1100, 1200],
  advances: new Map([
    [0x41, 500],
    [0x56, 400],
  ]),
  kerning: new Map([["65,86", -40]]),
};

const UNKERNED: PdfEmbeddedMetrics = { ...METRICS, kerning: new Map() };

describe("embeddedWidth", () => {
  test("sums the face's own advances, scaled to the point size", () => {
    expect(embeddedWidth("A", 10, METRICS)).toBeCloseTo(5, 9);
    expect(embeddedWidth("A", 20, METRICS)).toBeCloseTo(10, 9);
  });

  test("applies a pair adjustment between two glyphs, and only between them", () => {
    expect(embeddedWidth("AV", 10, METRICS)).toBeCloseTo(8.6, 9);
    expect(embeddedWidth("AV", 10, UNKERNED)).toBeCloseTo(9, 9);
  });

  test("a kerned run measures narrower, which is what moves a line break", () => {
    expect(embeddedWidth("AVAV", 10, METRICS)).toBeLessThan(embeddedWidth("AVAV", 10, UNKERNED));
  });

  test("does not kern the pair that opens a run, since there is nothing before it", () => {
    expect(embeddedWidth("VA", 10, METRICS)).toBeCloseTo(9, 9);
  });

  test("adds tracking once per character, as the base-14 path does", () => {
    expect(embeddedWidth("AA", 10, METRICS, { tracking: 2 })).toBeCloseTo(embeddedWidth("AA", 10, METRICS) + 4, 9);
  });

  test("measures a code point the face does not cover as nothing, so coverage is checked elsewhere", () => {
    expect(embeddedWidth("Z", 10, METRICS)).toBe(0);
  });
});
