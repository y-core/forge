import { describe, expect, test } from "bun:test";

import { createCursor } from "./cursor";
import { place } from "./elements";
import { Field, Heading, Note, OptionGroup, SignatureRow, TickList } from "./form";
import { COLUMN_GUTTER, MARGIN, PAGE_WIDTH, ROW_COLUMNS } from "./geometry";
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

describe("ROW_COLUMNS", () => {
  const COLUMN = (MEASURE.width - COLUMN_GUTTER * (ROW_COLUMNS - 1)) / ROW_COLUMNS;

  test("is the count a field's start is measured in", () => {
    const nodes = nodesOf(Field({ fields: [{ label: "Code", value: "7700", span: 4, start: 5 }] }));
    const label = nodes.find((node) => node.kind === "text");
    expect(label?.kind === "text" ? label.x : 0).toBeCloseTo(MEASURE.x + (COLUMN + COLUMN_GUTTER) * 4, 9);
  });

  test("is the span that fills the measure", () => {
    const rule = rulesIn(nodesOf(Field({ fields: [{ label: "Signature", labels: "above", span: ROW_COLUMNS }] })))[0];
    const commands = rule?.kind === "path" ? rule.commands : [];
    const xs = commands.flatMap((command) => (command.op === "close" ? [] : [command.x]));
    expect((xs.at(-1) ?? 0) - (xs[0] ?? 0)).toBeCloseTo(MEASURE.width, 9);
  });
});
