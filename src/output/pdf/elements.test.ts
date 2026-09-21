import { describe, expect, test } from "bun:test";

import { createCursor } from "./cursor";
import { columnsElement, fieldsElement, gridTracks, headingElement, noteElement, optionsElement, place, ticksElement } from "./elements";
import { OptionGroup, TickList } from "./form";
import { COLUMN_GUTTER, MARGIN, PAGE_WIDTH, ROW_COLUMNS } from "./geometry";
import { paginate } from "./paginate";
import { createPdfRenderer } from "./renderer";
import { structureTreeOf } from "./structure";
import type { PdfBox, PdfContent, PdfElement, PdfStructureNode } from "./types";

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

function pathsOf(node: PdfStructureNode, above: readonly string[] = []): { path: string[]; leaf: PdfStructureNode }[] {
  const here = [...above, node.type];
  return node.children.length === 0 ? [{ path: here, leaf: node }] : node.children.flatMap((child) => pathsOf(child, here));
}

function treeOf(content: PdfContent): PdfStructureNode {
  return structureTreeOf(paginate({ title: "Declaration", content }));
}

describe("a tick list reaches the tree as a list whose items say their own state", () => {
  const TICKS = TickList({
    items: [
      { label: "Certified copy of identity document attached", mark: "ticked" },
      { label: "Proof of residential address attached", mark: "empty" },
    ],
  });

  test("makes one list of two items, with no element for the row they share", () => {
    const found = pathsOf(treeOf([TICKS])).filter((entry) => entry.path.includes("L"));
    const items = found.map((entry) => entry.path.slice(entry.path.indexOf("L")));
    expect(items.every((path) => path[1] === "LI")).toBe(true);
    expect(new Set(items.map((path) => path.length))).toEqual(new Set([3]));
    expect(items.filter((path) => path[2] === "Lbl")).toHaveLength(2);
    expect(items.filter((path) => path[2] === "LBody")).toHaveLength(2);
  });

  // The state is the only thing the box says, and before this it reached no reader at all.
  test("gives each item's label the alternate text that distinguishes the two states", () => {
    const labels = pathsOf(treeOf([TICKS]))
      .filter((entry) => entry.leaf.type === "Lbl")
      .map((entry) => entry.leaf.alt);
    expect(labels).toEqual(["ticked", "empty"]);
  });

  test("carries the item's own words in its body", () => {
    const bodies = pathsOf(treeOf([TICKS]))
      .filter((entry) => entry.leaf.type === "LBody")
      .map((entry) => entry.leaf.text);
    expect(bodies[0]).toContain("Certified copy");
    expect(bodies[1]).toContain("Proof of residential address");
  });

  test("declares the list unnumbered, since a tick box is not an ordinal", async () => {
    const rendered = await createPdfRenderer({ tagged: true, compress: false }).render({ title: "Declaration", content: [TICKS] });
    if (!rendered.ok) throw new Error(rendered.error.message);
    expect(new TextDecoder("latin1").decode(rendered.data)).toContain("/A << /O /List /ListNumbering /None >>");
  });
});

describe("an option group is the same list, asked as a question", () => {
  test("makes one list whose items each carry a label and a body", () => {
    const options = OptionGroup({
      label: "In what capacity is the interest held?",
      options: [
        { label: "In my own name", mark: "ticked" },
        { label: "Through a trust", mark: "empty" },
        { label: "Through a company", mark: "crossed" },
      ],
    });
    const found = pathsOf(treeOf([options])).filter((entry) => entry.path.includes("L"));
    expect(found.filter((entry) => entry.leaf.type === "Lbl").map((entry) => entry.leaf.alt)).toEqual(["ticked", "empty", "crossed"]);
    expect(found.filter((entry) => entry.leaf.type === "LBody")).toHaveLength(3);
  });
});
