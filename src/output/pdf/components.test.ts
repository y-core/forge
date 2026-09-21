import { describe, expect, test } from "bun:test";

import { Box, Divider, KeepTogether, PageBreak, Row, Spacer, Stack, Text } from "./components";
import { createCursor } from "./cursor";
import { place } from "./elements";
import { Heading } from "./form";
import { LINE, MARGIN, PAGE_WIDTH } from "./geometry";
import { pdfContentBox, resolvePdfPage } from "./page";
import { paginate } from "./paginate";
import type { PdfBox, PdfElement, PdfNode } from "./types";

const PAPER = resolvePdfPage();
const CONTENT = pdfContentBox(PAPER);
const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: CONTENT.bottom - CONTENT.top };

function nodesOf(element: PdfElement, box: PdfBox = MEASURE): PdfNode[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  const from = cursor.pages.at(-1)?.nodes.length ?? 0;
  place(cursor, element, box);
  return (cursor.pages.at(-1)?.nodes ?? []).slice(from);
}

describe("every component takes one props object with children inside it", () => {
  test("each of them is callable with a single argument, which is what makes it a JSX target", () => {
    const leaf = Text({ children: "x" });
    const built: PdfElement[] = [
      Text({ children: "a run" }),
      Stack({ children: [leaf] }),
      Row({ children: [leaf] }),
      Box({ children: [leaf] }),
      KeepTogether({ children: [leaf] }),
      Spacer({ height: 4 }),
      Divider(),
      PageBreak(),
    ];
    expect(built.every((one) => one !== undefined)).toBe(true);
    expect(built.every((one) => typeof one.measure === "function" && typeof one.fragments === "function")).toBe(true);
  });

  // A container that forgets this is audited as if it held nothing, so the omission is caught where
  // the container is written rather than as a clean audit of a document that is not.
  test("every container declares the children it holds, which is all an audit can reach them by", () => {
    const leaf = Text({ children: "x" });
    const containers = [Stack, Row, Box, KeepTogether].map((of) => of({ children: [leaf] }));
    expect(containers.map((one) => one.children)).toEqual(containers.map(() => [leaf]));
    expect(Text({ children: "a run" }).children).toBeUndefined();
  });

  // The narrow rule: a break three children down is one pagination cannot honour, because a
  // container lays out as one element.
  test("a container opens a section only where its own first child does", () => {
    const heading = Heading({ children: "Interests" });
    const body = Text({ children: "x" });
    expect(Stack({ children: [heading, body] }).startsSection).toBe(true);
    expect(Stack({ children: [body, heading] }).startsSection).toBeUndefined();
    expect(Stack({ children: [] }).startsSection).toBeUndefined();
  });
});

describe("Text", () => {
  test("sets its run at the left edge of the box it was given", () => {
    const [node] = nodesOf(Text({ children: "Du Toit" }), { x: 100, width: 300, height: MEASURE.height });
    expect(node).toMatchObject({ kind: "text", run: "Du Toit", x: 100 });
  });

  test("wraps to the width of its box, a line at a time", () => {
    const wide = nodesOf(Text({ children: "one two three four five" }), { x: 0, width: 400, height: MEASURE.height });
    const narrow = nodesOf(Text({ children: "one two three four five" }), { x: 0, width: 40, height: MEASURE.height });
    expect(wide).toHaveLength(1);
    expect(narrow.length).toBeGreaterThan(1);
  });

  test("sets bold where it is asked to, and regular otherwise", () => {
    expect(nodesOf(Text({ children: "x", bold: true }))[0]).toMatchObject({ face: "bold" });
    expect(nodesOf(Text({ children: "x" }))[0]).toMatchObject({ face: "regular" });
  });
});

describe("Stack", () => {
  test("stacks its children, leaving `gap` between them and none after the last", () => {
    const one = Text({ children: "one" });
    const tight = Stack({ children: [one, one, one] });
    const spaced = Stack({ children: [one, one, one], gap: 10 });
    expect(tight.measure(MEASURE.width).height).toBeCloseTo(LINE * 3, 9);
    expect(spaced.measure(MEASURE.width).height).toBeCloseTo(LINE * 3 + 20, 9);
  });
});

describe("Row", () => {
  test("gives each child the room its track resolves to", () => {
    const nodes = nodesOf(Row({ children: [Text({ children: "a" }), Text({ children: "b" })], tracks: [3, 1], gap: 0 }), {
      x: 0,
      width: 400,
      height: MEASURE.height,
    });
    const xs = nodes.filter((node) => node.kind === "text").map((node) => node.x);
    expect(xs).toEqual([0, 300]);
  });

  test("gives a fixed track exactly its points and divides the rest between the shares", () => {
    const nodes = nodesOf(Row({ children: [Text({ children: "a" }), Text({ children: "b" })], tracks: [{ points: 100 }, 1], gap: 0 }), {
      x: 0,
      width: 400,
      height: MEASURE.height,
    });
    expect(nodes.filter((node) => node.kind === "text").map((node) => node.x)).toEqual([0, 100]);
  });

  test("shares one baseline across its cells, so a tall cell does not push a short one down", () => {
    const row = Row({ children: [Text({ children: "one two three four five six" }), Text({ children: "b" })], tracks: [1, 1], gap: 0 });
    const nodes = nodesOf(row, { x: 0, width: 120, height: MEASURE.height });
    const ys = nodes.filter((node) => node.kind === "text").map((node) => node.y);
    expect(ys.at(-1)).toBe(ys[0]);
    expect(row.fragments({ x: 0, width: 120, height: MEASURE.height })).toHaveLength(1);
  });

  test("defaults to one equal share per child where no tracks are given", () => {
    const nodes = nodesOf(Row({ children: [Text({ children: "a" }), Text({ children: "b" })] }), { x: 0, width: 400, height: MEASURE.height });
    expect(nodes.filter((node) => node.kind === "text").map((node) => node.x)).toEqual([0, 200]);
  });
});

describe("Box", () => {
  test("insets its children on every side by its padding", () => {
    const [node] = nodesOf(Box({ children: [Text({ children: "x" })], padding: 20 }), { x: 0, width: 400, height: MEASURE.height });
    expect(node).toMatchObject({ x: 20 });
  });

  test("adds its padding to the height its children measure", () => {
    const bare = Box({ children: [Text({ children: "x" })] });
    const padded = Box({ children: [Text({ children: "x" })], padding: 20 });
    expect(padded.measure(400).height - bare.measure(400).height).toBeCloseTo(40, 9);
  });
});

describe("Spacer and Divider", () => {
  test("a spacer leaves its height and draws nothing", () => {
    expect(nodesOf(Spacer({ height: 24 }))).toEqual([]);
    expect(Spacer({ height: 24 }).measure(400).height).toBe(24);
  });

  test("a divider rules across its box and takes no height", () => {
    const [node] = nodesOf(Divider(), { x: 10, width: 200, height: MEASURE.height });
    expect(node).toMatchObject({
      kind: "path",
      commands: [
        { op: "move", x: 10 },
        { op: "line", x: 210 },
      ],
    });
    expect(Divider().measure(400).height).toBe(0);
  });
});

describe("KeepTogether", () => {
  test("collapses its children into one fragment, so a break cannot fall inside it", () => {
    const children = [Text({ children: "one" }), Text({ children: "two" }), Text({ children: "three" })];
    expect(Stack({ children }).fragments(MEASURE)).toHaveLength(3);
    expect(KeepTogether({ children }).fragments(MEASURE)).toHaveLength(1);
  });

  test("reserves the whole of itself, so the break happens before it rather than inside it", () => {
    const children = [Text({ children: "one" }), Text({ children: "two" })];
    const [fragment] = KeepTogether({ children }).fragments(MEASURE);
    expect(fragment?.reserve).toBeCloseTo(LINE * 2, 9);
  });
});

describe("PageBreak", () => {
  test("opens a page when the current one has been written to, and not otherwise", () => {
    const cursor = createCursor(undefined);
    cursor.newPage();
    place(cursor, PageBreak(), MEASURE);
    expect(cursor.pages).toHaveLength(1);
    place(cursor, Text({ children: "x" }), MEASURE);
    place(cursor, PageBreak(), MEASURE);
    expect(cursor.pages).toHaveLength(2);
  });
});

describe("a group no page could hold breaks rather than printing off the page", () => {
  const tall = Array.from({ length: 80 }, (_value, at) => Text({ children: `line ${at}` }));

  function lowestTextOf(element: PdfElement): number {
    const pages = paginate({ title: "Declaration", content: [element] });
    return Math.max(...pages.flatMap((page) => page.nodes.filter((node) => node.kind === "text").map((node) => node.y)));
  }

  test("KeepTogether keeps a group whole only while a page could hold it", () => {
    expect(KeepTogether({ children: tall }).fragments(MEASURE).length).toBeGreaterThan(1);
    expect(KeepTogether({ children: [Text({ children: "one" })] }).fragments(MEASURE)).toHaveLength(1);
  });

  test("KeepTogether puts no run below the bottom margin", () => {
    expect(lowestTextOf(KeepTogether({ children: tall }))).toBeLessThanOrEqual(CONTENT.bottom);
  });

  test("Row gives its cells back their own fragments when no page could hold the row", () => {
    const row = Row({ children: [Stack({ children: tall }), Text({ children: "beside" })], tracks: [1, 1] });
    expect(row.fragments(MEASURE).length).toBeGreaterThan(1);
    expect(lowestTextOf(row)).toBeLessThanOrEqual(CONTENT.bottom);
  });

  test("Row that fits stays one fragment, so its cells keep their shared baseline", () => {
    const row = Row({ children: [Text({ children: "a" }), Text({ children: "b" })], tracks: [1, 1] });
    expect(row.fragments(MEASURE)).toHaveLength(1);
  });
});

describe("breakWord", () => {
  const LONG = "Pneumonoultramicroscopicsilicovolcanoconiosis";
  const NARROW: PdfBox = { x: 0, width: 60, height: MEASURE.height };

  test("lets an over-long word overflow its column by default, rather than cutting it", () => {
    const runs = nodesOf(Text({ children: LONG }), NARROW)
      .filter((node) => node.kind === "text")
      .map((node) => node.run);
    expect(runs).toEqual([LONG]);
  });

  test("cuts it where the caller asks, so the whole word is still on the page", () => {
    const runs = nodesOf(Text({ children: LONG, breakWord: true }), NARROW)
      .filter((node) => node.kind === "text")
      .map((node) => node.run);
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.join("")).toBe(LONG);
  });

  test("changes the measured height, so the choice is visible before anything is drawn", () => {
    expect(Text({ children: LONG, breakWord: true }).measure(NARROW.width).height).toBeGreaterThan(
      Text({ children: LONG }).measure(NARROW.width).height,
    );
  });
});
