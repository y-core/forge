/** @jsxImportSource @y-core/forge/render/pdf */

import { describe, expect, test } from "bun:test";

import { Text } from "./components";
import { createCursor } from "./cursor";
import { place } from "./elements";
import { MARGIN, PAGE_WIDTH } from "./geometry";
import { Table } from "./table";
import { toPdfElements } from "./tree";
import type { PdfBox, PdfContent, PdfNode, PdfTextNode } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

function textOf(content: PdfContent): PdfTextNode[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  for (const element of toPdfElements(content)) place(cursor, element, MEASURE);
  return (cursor.pages.at(-1)?.nodes ?? []).filter((node: PdfNode): node is PdfTextNode => node.kind === "text");
}

describe("a Table whose cells are written as JSX", () => {
  test("lays out a single-element cell in its column, header row first", () => {
    const table = Table({ header: [<Text>Class</Text>, <Text>Held</Text>], rows: [[<Text>Ordinary</Text>, <Text>1 250 000</Text>]] });
    const nodes = textOf(table);
    expect(nodes.map((node) => node.run)).toEqual(["Class", "Held", "Ordinary", "1 250 000"]);
    expect(nodes[2]?.x).toBe(nodes[0]?.x);
    expect(nodes[3]?.x).toBe(nodes[1]?.x);
    expect(nodes[1]!.x).toBeGreaterThan(nodes[0]!.x);
  });

  test("stacks a cell of several elements within its own column", () => {
    const cell = (
      <>
        <Text>Meridian</Text>
        <Text>Holdings</Text>
      </>
    );
    const table = Table({ header: [cell, <Text>Since</Text>], rows: [[cell, <Text>2019</Text>]] });
    const nodes = textOf(table);
    const [meridian, holdings] = nodes.filter((node) => node.run === "Meridian" || node.run === "Holdings");
    expect(meridian?.x).toBe(holdings?.x);
    expect(holdings!.y).toBeGreaterThan(meridian!.y);
    expect(nodes.map((node) => node.run)).toEqual(["Meridian", "Holdings", "Since", "Meridian", "Holdings", "2019"]);
  });

  test("keeps the column of a cell whose condition rendered nothing", () => {
    const shown = false;
    const table = Table({ header: [<Text>Class</Text>, <Text>Held</Text>], rows: [[shown && <Text>Ordinary</Text>, <Text>2019</Text>]] });
    const nodes = textOf(table);
    expect(nodes.map((node) => node.run)).toEqual(["Class", "Held", "2019"]);
    expect(nodes[2]?.x).toBe(nodes[1]?.x);
  });

  test("lowers its cells the same when the Table itself is written as JSX", () => {
    const viaJsx = textOf(<Table header={[<Text>Class</Text>]} rows={[[<Text>Ordinary</Text>]]} />);
    const viaFactory = textOf(Table({ header: [Text({ children: "Class" })], rows: [[Text({ children: "Ordinary" })]] }));
    expect(viaJsx).toEqual(viaFactory);
  });
});
