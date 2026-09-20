import { describe, expect, test } from "bun:test";

import { createCursor } from "./cursor";
import { place } from "./elements";
import { createPdfGrid, Field, Heading, Note, OptionGroup, SignatureRow, TickList } from "./form";
import { COLUMN_GUTTER, MARGIN, PAGE_WIDTH, ROW_COLUMNS } from "./geometry";
import { resolveTracks } from "./tracks";
import type { PdfBox, PdfElement, PdfNode } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

function nodesOf(element: PdfElement): PdfNode[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  const from = cursor.pages.at(-1)?.nodes.length ?? 0;
  place(cursor, element, MEASURE);
  return (cursor.pages.at(-1)?.nodes ?? []).slice(from);
}

function runsOf(nodes: PdfNode[]): string[] {
  return nodes.filter((node) => node.kind === "text").map((node) => node.run);
}

// A tick box is the one closed path a form draws; its tick and every rule are open runs of points.
function boxesIn(nodes: PdfNode[]): PdfNode[] {
  return nodes.filter((node) => node.kind === "path" && node.commands.at(-1)?.op === "close");
}

function rulesIn(nodes: PdfNode[]): PdfNode[] {
  return nodes.filter((node) => node.kind === "path" && node.commands.at(-1)?.op === "line");
}

describe("the printed-form vocabulary", () => {
  test("Heading sets a section head in capitals, over its rule", () => {
    const nodes = nodesOf(Heading({ children: "Part A" }));
    expect(runsOf(nodes)).toEqual(["PART A"]);
    expect(rulesIn(nodes)).not.toHaveLength(0);
  });

  test("Heading at level two is a sub-heading, which sets as written and rules nothing", () => {
    const nodes = nodesOf(Heading({ level: 2, children: "Contact" }));
    expect(runsOf(nodes)).toEqual(["Contact"]);
    expect(rulesIn(nodes)).toHaveLength(0);
  });

  test("Field sets a question and its answer, and rules a blank one for the reader", () => {
    expect(runsOf(nodesOf(Field({ fields: [{ label: "Surname", value: "Du Toit" }] })))).toEqual(["Surname", "Du Toit"]);
    expect(rulesIn(nodesOf(Field({ fields: [{ label: "Surname" }] })))).not.toHaveLength(0);
  });

  test("Note sets explanatory copy and breaks a line at a time", () => {
    const long = Array.from({ length: 120 }, (_value, at) => `word${at}`).join(" ");
    expect(Note({ children: long }).fragments(MEASURE).length).toBeGreaterThan(2);
  });

  test("TickList sets a box beside each line", () => {
    const nodes = nodesOf(TickList({ items: [{ label: "Attached", mark: "ticked" }] }));
    expect(runsOf(nodes)).toEqual(["Attached"]);
    expect(boxesIn(nodes)).toHaveLength(1);
  });

  test("OptionGroup sets a question and a box for each answer", () => {
    const nodes = nodesOf(
      OptionGroup({
        label: "Capacity?",
        options: [
          { label: "Own name", mark: "ticked" },
          { label: "A trust", mark: "empty" },
        ],
      }),
    );
    expect(runsOf(nodes)).toEqual(["Capacity?", "Own name", "A trust"]);
    expect(boxesIn(nodes)).toHaveLength(2);
  });

  test("SignatureRow sets each cell's label over its answer, and rules a blank one", () => {
    const nodes = nodesOf(
      SignatureRow({
        cells: [
          { label: "City", value: "Cape Town" },
          { label: "Province", blank: true },
        ],
      }),
    );
    expect(runsOf(nodes)).toEqual(["City", "Cape Town", "Province"]);
    expect(rulesIn(nodes)).toHaveLength(1);
  });

  test("a heading opens a section; nothing else does, so a run stays with the head it belongs to", () => {
    expect(Heading({ children: "Part A" }).startsSection).toBe(true);
    expect(Field({ fields: [{ label: "Surname" }] }).startsSection).toBeUndefined();
  });
});

describe("createPdfGrid", () => {
  test("lowers to tracks rather than carrying a column count of its own", () => {
    const grid = createPdfGrid();
    expect(grid.tracks).toHaveLength(ROW_COLUMNS);
    expect(grid.widths(MEASURE.width)).toEqual(resolveTracks(grid.tracks, MEASURE.width, COLUMN_GUTTER));
  });

  test("starts the first column at nothing and ends a full span on the measure", () => {
    const grid = createPdfGrid();
    expect(grid.columnX(MEASURE.width, 1)).toBe(0);
    expect(grid.spanWidth(MEASURE.width, 1, ROW_COLUMNS)).toBeCloseTo(MEASURE.width, 9);
  });

  test("takes a column count and a gap of its own where the caller names them", () => {
    const grid = createPdfGrid({ columns: 4, gap: 0 });
    expect(grid.widths(400)).toEqual([100, 100, 100, 100]);
    expect(grid.columnX(400, 3)).toBe(200);
    expect(grid.spanWidth(400, 2, 2)).toBe(200);
  });

  test("places a field at the same x the grid resolves for its span", () => {
    const grid = createPdfGrid();
    const nodes = nodesOf(Field({ fields: [{ label: "Code", value: "7700", span: 4, start: 5 }] }));
    const label = nodes.find((node) => node.kind === "text");
    expect(label?.kind === "text" ? label.x : 0).toBeCloseTo(MEASURE.x + grid.columnX(MEASURE.width, 5), 9);
  });
});
