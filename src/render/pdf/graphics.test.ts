import { describe, expect, test } from "bun:test";

import { Text } from "./components";
import { createCursor } from "./cursor";
import { place } from "./elements";
import { MARGIN, PAGE_WIDTH } from "./geometry";
import { Image, Panel, Path } from "./graphics";
import { createPdfPen } from "./path";
import type { PdfBox, PdfElement, PdfImage, PdfNode, PdfShadingStops } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

const STOPS: PdfShadingStops = [
  { at: 0, ink: [1, 1, 1] },
  { at: 1, ink: [0, 0, 0] },
];

function nodesOf(element: PdfElement): PdfNode[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  const from = cursor.pages.at(-1)?.nodes.length ?? 0;
  place(cursor, element, MEASURE);
  return (cursor.pages.at(-1)?.nodes ?? []).slice(from);
}

const CHEVRON = createPdfPen().move(0, 0).line(6, 6).line(0, 12).commands();

describe("Path", () => {
  test("draws its commands from its own top-left corner, wherever the box puts it", () => {
    const [node] = nodesOf(Path({ commands: CHEVRON, height: 12 }));
    expect(node).toMatchObject({ kind: "path", commands: [{ op: "move", x: MARGIN }, {}, {}] });
  });

  test("takes the height it declares, so what follows it is set beneath it", () => {
    expect(Path({ commands: CHEVRON, height: 12 }).measure(MEASURE.width).height).toBe(12);
  });

  test("strokes where it is given a stroke and no fill", () => {
    const nodes = nodesOf(Path({ commands: CHEVRON, height: 12, stroke: [0, 0, 0], weight: 1.5 }));
    expect(nodes.find((node) => node.kind === "path")).toMatchObject({ paint: "stroke", weight: 1.5 });
  });

  test("fills and strokes where it is given both", () => {
    const nodes = nodesOf(Path({ commands: CHEVRON, height: 12, fill: [1, 0, 0], stroke: [0, 0, 0], weight: 1 }));
    expect(nodes.find((node) => node.kind === "path")).toMatchObject({ paint: "fill-stroke" });
  });

  test("a gradient takes the place of the fill ink rather than joining it", () => {
    const nodes = nodesOf(Path({ commands: CHEVRON, height: 12, fill: { kind: "axial", from: [0, 0], to: [0, 12], stops: STOPS } }));
    expect(nodes.some((node) => node.kind === "ink")).toBe(false);
    expect(nodes.find((node) => node.kind === "path")).toMatchObject({ shading: { kind: "axial" } });
  });

  test("carries its alpha onto the node, which is where the graphics state comes from", () => {
    const nodes = nodesOf(Path({ commands: CHEVRON, height: 12, fill: [1, 0, 0], alpha: 0.5 }));
    expect(nodes.find((node) => node.kind === "path")).toMatchObject({ alpha: 0.5 });
  });

  test("is artwork unless it is told otherwise", () => {
    const [node] = nodesOf(Path({ commands: CHEVRON, height: 12, tag: "rule" }));
    expect(node?.tag).toBe("rule");
  });
});

describe("Image", () => {
  const image: PdfImage = {
    width: 200,
    height: 100,
    bytes: new Uint8Array(),
    bitsPerComponent: 8,
    colourSpace: "/DeviceRGB",
    filter: "FlateDecode",
  };

  test("fills the width of its box, and takes the height that width implies", () => {
    const [node] = nodesOf(Image({ image }));
    expect(node).toMatchObject({ kind: "image", x: MARGIN, width: MEASURE.width, height: MEASURE.width / 2 });
  });

  test("keeps the image's own aspect ratio where only a width is given", () => {
    expect(Image({ image, width: 80 }).measure(MEASURE.width).height).toBe(40);
  });

  test("takes both when both are given, since a caller may want the image distorted", () => {
    const [node] = nodesOf(Image({ image, width: 30, height: 90 }));
    expect(node).toMatchObject({ width: 30, height: 90 });
  });

  test("carries an alpha onto the node, so a watermark draws through what is under it", () => {
    expect(nodesOf(Image({ image, alpha: 0.2 }))[0]).toMatchObject({ alpha: 0.2 });
  });
});

describe("Panel", () => {
  const panel = Panel({ children: [Text({ children: "Inside" })], padding: 8, radius: 4, fill: [0.9, 0.9, 0.9] });

  test("draws its box before its children, so the children read over it rather than under", () => {
    const nodes = nodesOf(panel);
    expect(nodes.findIndex((node) => node.kind === "path")).toBeLessThan(nodes.findIndex((node) => node.kind === "text"));
  });

  test("sizes the box to what its children measure, padding included", () => {
    const nodes = nodesOf(panel);
    const box = nodes.find((node) => node.kind === "path");
    const edges = box?.kind === "path" ? box.commands.flatMap((command) => ("y" in command ? [command.y] : [])) : [];
    expect(Math.max(...edges) - Math.min(...edges)).toBe(panel.measure(MEASURE.width).height);
  });

  test("breaks nowhere inside itself, since a background that broke would print on one page only", () => {
    expect(panel.fragments(MEASURE)).toHaveLength(1);
  });

  test("declares the children it holds, so a drawing inside it is not invisible to an audit", () => {
    const inside = Text({ children: "Inside" });
    expect(Panel({ children: [inside] }).children).toEqual([inside]);
  });

  test("rounds each corner on its own radius", () => {
    const nodes = nodesOf(Panel({ children: [Text({ children: "x" })], radius: { topLeft: 12 }, fill: [0, 0, 0] }));
    const box = nodes.find((node) => node.kind === "path");
    expect(box?.kind === "path" ? box.commands.filter((command) => command.op === "line")[2] : undefined).toMatchObject({ x: MARGIN + 12 });
  });
});
