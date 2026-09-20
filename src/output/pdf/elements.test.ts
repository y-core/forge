import { describe, expect, test } from "bun:test";

import { createCursor } from "./cursor";
import { columnsElement, fieldsElement, gridTracks, headingElement, noteElement, optionsElement, place, ticksElement } from "./elements";
import { COLUMN_GUTTER, MARGIN, PAGE_WIDTH, ROW_COLUMNS } from "./geometry";
import type { PdfBox, PdfElement } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

function advanceOf(element: PdfElement): number {
  const cursor = createCursor(undefined);
  cursor.newPage();
  const before = cursor.y;
  place(cursor, element, MEASURE);
  return cursor.y - before;
}

describe("an element answers its height before anything paints it", () => {
  const CASES: [string, PdfElement][] = [
    ["a heading", headingElement("Part A")],
    ["a note", noteElement("A note that runs to some length so that it wraps across more than one line of the measure.")],
    ["a field row", fieldsElement([{ label: "Surname", value: "Du Toit" }])],
    ["a signature row", columnsElement([{ label: "City", value: "Cape Town" }])],
    ["a tick list", ticksElement([{ label: "One", mark: "empty" }])],
    ["an option group", optionsElement("Capacity?", [{ label: "Own name", mark: "ticked" }])],
  ];

  for (const [name, element] of CASES) {
    test(`${name}'s measured height is exactly what painting advances the baseline by`, () => {
      expect(advanceOf(element)).toBeCloseTo(element.measure(MEASURE.width).height, 9);
    });
  }
});

describe("what an element wants and what it needs", () => {
  test("a field row wants the width of its longest run and needs its longest word", () => {
    const measured = fieldsElement([{ label: "Surname", value: "Du Toit" }]).measure(MEASURE.width);
    expect(measured.preferred).toBeGreaterThan(0);
    expect(measured.minimum).toBeGreaterThan(0);
    expect(measured.minimum).toBeLessThanOrEqual(measured.preferred);
  });

  test("an element with no runs wants nothing", () => {
    expect(fieldsElement([]).measure(MEASURE.width)).toMatchObject({ preferred: 0, minimum: 0, height: 0 });
  });
});

describe("an element lays itself out in the box it is given, not on the page", () => {
  test("a heading set in a narrower box wraps sooner and grows taller", () => {
    const heading = headingElement("A section heading long enough to need more than one line when the column narrows");
    expect(heading.measure(160).height).toBeGreaterThan(heading.measure(MEASURE.width).height);
  });

  test("a note set at an offset starts where its box starts", () => {
    const cursor = createCursor(undefined);
    cursor.newPage();
    place(cursor, noteElement("x"), { x: 200, width: 100, height: MEASURE.height });
    const run = (cursor.pages[0]?.nodes ?? []).find((node) => node.kind === "text");
    expect(run?.kind === "text" ? run.x : 0).toBe(200);
  });
});

describe("the printed grid is the track model", () => {
  test("resolves twelve uniform tracks across the measure it is given", () => {
    const widths = gridTracks(MEASURE.width);
    expect(widths).toHaveLength(ROW_COLUMNS);
    expect(widths[0]).toBeCloseTo((MEASURE.width - COLUMN_GUTTER * (ROW_COLUMNS - 1)) / ROW_COLUMNS, 9);
  });
});
