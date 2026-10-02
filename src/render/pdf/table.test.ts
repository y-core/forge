import { describe, expect, test } from "bun:test";

import { Text } from "./components";
import { createCursor } from "./cursor";
import { place } from "./elements";
import { MARGIN, PAGE_WIDTH } from "./geometry";
import { paginate } from "./paginate";
import { createPdfRenderer } from "./renderer";
import { structureTreeOf } from "./structure";
import { Table } from "./table";
import type { PdfBox, PdfDocument, PdfElement, PdfNode, PdfStructureNode, PdfTextNode } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

function cell(run: string): PdfElement {
  return Text({ children: run });
}

function textOf(nodes: readonly PdfNode[]): PdfTextNode[] {
  return nodes.filter((node) => node.kind === "text");
}

function nodesOf(element: PdfElement): PdfNode[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  const from = cursor.pages.at(-1)?.nodes.length ?? 0;
  place(cursor, element, MEASURE);
  return (cursor.pages.at(-1)?.nodes ?? []).slice(from);
}

describe("a table's columns agree across every row", () => {
  test("one resolution is applied to all rows, whatever each row's content measures", () => {
    const table = Table({
      header: [cell("Class"), cell("Held")],
      rows: [
        [cell("Ordinary"), cell("1 250 000")],
        [cell("A"), cell("1")],
      ],
    });
    const xs = textOf(nodesOf(table)).map((node) => node.x);
    const columns = [...new Set(xs)];
    expect(columns).toHaveLength(2);
    expect(xs).toEqual([columns[0], columns[1], columns[0], columns[1], columns[0], columns[1]]);
  });

  test("a fixed track keeps its points and the shares divide the rest", () => {
    const table = Table({ tracks: [{ points: 100 }, 1], rows: [[cell("a"), cell("b")]] });
    const xs = textOf(nodesOf(table)).map((node) => node.x);
    expect(xs).toEqual([MEASURE.x, MEASURE.x + 100]);
  });

  test("a table with no tracks gives every column an equal share", () => {
    const table = Table({ rows: [[cell("a"), cell("b"), cell("c")]] });
    const xs = textOf(nodesOf(table)).map((node) => node.x);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 9);
  });
});

describe("a table across a page break", () => {
  const rows = Array.from({ length: 80 }, (_value, at) => [cell(`row ${at}`), cell(`value ${at}`)]);
  const doc = { title: "Holdings", content: [Table({ header: [cell("Class"), cell("Held")], rows })] };

  test("repeats its header at the top of every page it continues onto", () => {
    const pages = paginate(doc);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(textOf(page.nodes).map((node) => node.run)).toContain("Class");
  });

  test("emits the header once per page, not once per row", () => {
    for (const page of paginate(doc)) {
      expect(textOf(page.nodes).filter((node) => node.run === "Class")).toHaveLength(1);
    }
  });

  test("keeps every row whole, so a row's cells never straddle the seam", () => {
    for (const page of paginate(doc)) {
      const runs = textOf(page.nodes).map((node) => node.run);
      for (const run of runs.filter((one) => one.startsWith("row "))) {
        expect(runs).toContain(run.replace("row ", "value "));
      }
    }
  });

  test("omits the header entirely where the table declares none", () => {
    const pages = paginate({ title: "Holdings", content: [Table({ rows })] });
    expect(textOf(pages[0]?.nodes ?? []).map((node) => node.run)).not.toContain("Class");
  });
});

describe("a table measures before it is drawn", () => {
  test("its height is the header plus every row", () => {
    const one = Table({ rows: [[cell("a")]] });
    const three = Table({ rows: [[cell("a")], [cell("b")], [cell("c")]] });
    const headed = Table({ header: [cell("h")], rows: [[cell("a")]] });
    expect(three.measure(MEASURE.width).height).toBeCloseTo(one.measure(MEASURE.width).height * 3, 9);
    expect(headed.measure(MEASURE.width).height).toBeCloseTo(one.measure(MEASURE.width).height * 2, 9);
  });

  test("an empty table draws nothing and takes no room", () => {
    expect(nodesOf(Table({ rows: [] }))).toEqual([]);
    expect(Table({ rows: [] }).measure(MEASURE.width).height).toBe(0);
  });
});

// The tree is asked rather than the bytes for shape, and the bytes for the one attribute a shape
// cannot carry — `/Scope` is what tells a reader which column a cell it announces belongs to.
function pathsOf(node: PdfStructureNode, above: readonly string[] = []): string[][] {
  const here = [...above, node.type];
  return node.children.length === 0 ? [here] : node.children.flatMap((child) => pathsOf(child, here));
}

describe("what a Table declares about itself", () => {
  test("declares every cell it holds, header row first, which is the order a reader takes them in", () => {
    const heading = cell("Interest");
    const first = cell("Meridian");
    const second = cell("2019");
    expect(Table({ header: [heading], rows: [[first], [second]] }).children).toEqual([heading, first, second]);
  });

  // A cell opens no section: a table lays out as one element, so a break inside it is one pagination
  // has no way to take.
  test("opens no section, whatever a cell of its own would open", () => {
    expect(Table({ rows: [[cell("Meridian")]] }).startsSection).toBeUndefined();
  });
});

describe("a Table reaches the tree as a table rather than as loose paragraphs", () => {
  const words = (run: string): PdfElement => Text({ children: run });
  const TABLED: PdfDocument = {
    title: "Declaration",
    content: [
      Table({
        header: [words("Interest"), words("Held since")],
        rows: [
          [words("Meridian Holdings"), words("2019")],
          [words("Rondebosch Trust"), words("2021")],
        ],
      }),
    ],
  };

  test("nests every cell under a row and every row under one table", () => {
    const paths = pathsOf(structureTreeOf(paginate(TABLED)));
    const inTable = paths.filter((path) => path.includes("Table"));
    expect(inTable.length).toBeGreaterThan(0);
    for (const path of inTable) expect(path.slice(path.indexOf("Table"), path.indexOf("Table") + 2)).toEqual(["Table", "TR"]);
    expect(new Set(inTable.map((path) => path.filter((type) => type === "Table").length))).toEqual(new Set([1]));
  });

  test("makes the header row header cells and every body cell a data cell", () => {
    const paths = pathsOf(structureTreeOf(paginate(TABLED))).filter((path) => path.includes("Table"));
    const cells = paths.map((path) => path[path.indexOf("TR") + 1]);
    expect(cells).toContain("TH");
    expect(cells).toContain("TD");
    expect(cells.filter((type) => type === "TH")).toHaveLength(2);
  });

  test("declares the header cell's scope, which is what names the column a reader is in", async () => {
    const rendered = await createPdfRenderer({ tagged: true, compress: false }).render(TABLED);
    if (!rendered.ok) throw new Error(rendered.error.message);
    const text = new TextDecoder("latin1").decode(rendered.data);
    expect(text).toContain("/S /TH");
    expect(text).toContain("/A << /O /Table /Scope /Column >>");
  });

  test("a table continuing onto a second page is one table carrying its own header set there", () => {
    const long: PdfDocument = {
      title: "Declaration",
      content: [
        Table({
          header: [words("Interest"), words("Held since")],
          rows: Array.from({ length: 70 }, (_row, at) => [words(`Holding ${at}`), words("2019")]),
        }),
      ],
    };
    const pages = paginate(long);
    expect(pages.length).toBeGreaterThan(1);
    const tree = structureTreeOf(pages);
    const tables = pathsOf(tree).filter((path) => path.includes("Table"));
    expect(new Set(tables.map((path) => path.filter((type) => type === "Table").length))).toEqual(new Set([1]));
    // One `/TH` set per page it continues onto, because the repeat is ink a reader meets again.
    const headers = tables.filter((path) => path[path.indexOf("TR") + 1] === "TH");
    expect(headers.length).toBe(pages.length * 2);
  });
});
