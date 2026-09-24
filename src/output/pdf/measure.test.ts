import { describe, expect, test } from "bun:test";

import { Field, Heading, Note } from "./form";
import { LINE, MARGIN, NOTE_SIZE, PAGE_HEIGHT, PAGE_WIDTH } from "./geometry";
import { measureRun, minimumWidth, preferredWidth } from "./measure";
import { textWidth, wrapText } from "./text";
import type { PdfBox, PdfElement } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: PAGE_HEIGHT - MARGIN * 2 };

describe("what a run wants", () => {
  test("is the width of the whole of it, set on one line", () => {
    expect(preferredWidth("one two three", 10)).toBeCloseTo(textWidth("one two three", 10), 9);
  });

  test("is the widest line where the run carries its own breaks", () => {
    expect(preferredWidth("short\na much longer line", 10)).toBeCloseTo(textWidth("a much longer line", 10), 9);
  });

  test("is nothing at all for an empty run", () => {
    expect(preferredWidth("", 10)).toBe(0);
  });
});

describe("what a run needs", () => {
  test("is the width of its widest word, because that is what cannot be broken", () => {
    expect(minimumWidth("one extraordinary two", 10)).toBeCloseTo(textWidth("extraordinary", 10), 9);
  });

  test("never exceeds what it wants", () => {
    const text = "a moderately long sentence of several words";
    expect(minimumWidth(text, 10)).toBeLessThanOrEqual(preferredWidth(text, 10));
  });
});

describe("a run of elements is measured, never drawn and discarded", () => {
  test("reports the height the same elements advance the baseline by", () => {
    const elements: PdfElement[] = [Heading({ children: "Part A" }), Field({ fields: [{ label: "Surname", value: "Du Toit" }] })];
    const expected = elements.reduce((total, element) => total + element.measure(MEASURE.width).height, 0);
    expect(measureRun(elements, MEASURE, MARGIN, PAGE_HEIGHT - MARGIN).height).toBeCloseTo(expected, 9);
  });

  test("fits a short run on one page", () => {
    expect(measureRun([Field({ fields: [{ label: "Surname", value: "Du Toit" }] })], MEASURE, MARGIN, PAGE_HEIGHT - MARGIN).fits).toBe(true);
  });

  test("does not fit a run taller than the page it is measured against", () => {
    const rows = Array.from({ length: 80 }, () => Field({ fields: [{ label: "Surname", value: "Du Toit" }] }));
    expect(measureRun(rows, MEASURE, MARGIN, PAGE_HEIGHT - MARGIN).fits).toBe(false);
  });

  test("measures a note by the line, because that is how a note breaks", () => {
    const long = Array.from({ length: 200 }, (_value, at) => `word${at}`).join(" ");
    const element = Note({ children: long });
    const lines = element.fragments(MEASURE).length;
    expect(lines).toBeGreaterThan(2);
    expect(element.measure(MEASURE.width).height).toBeCloseTo((lines - 1) * LINE + 4, 9);
    expect(wrapText(long, NOTE_SIZE, MEASURE.width).length * LINE).toBeCloseTo((lines - 1) * LINE, 9);
  });
});
