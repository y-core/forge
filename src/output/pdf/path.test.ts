import { describe, expect, test } from "bun:test";

import { PAGE_HEIGHT } from "./geometry";
import { createPdfPen, pathOperators, roundedBoxCommands } from "./path";
import { createPdfResources } from "./resources";
import type { PdfPathCommand, PdfPathNode, PdfPathPaint, PdfShadingStops } from "./types";

const up = (y: number): number => PAGE_HEIGHT - y;

function draw(commands: readonly PdfPathCommand[], paint: PdfPathPaint = {}): string {
  const node: PdfPathNode = { kind: "path", tag: "artwork", commands, ...paint };
  return pathOperators(node, up, createPdfResources(PAGE_HEIGHT));
}

const STOPS: PdfShadingStops = [
  { at: 0, ink: [1, 0, 0] },
  { at: 1, ink: [0, 0, 1] },
];

describe("the pen", () => {
  test("records every step in the order it was drawn, and returns itself at each one", () => {
    const pen = createPdfPen();
    expect(pen.move(1, 2).line(3, 4).close()).toBe(pen);
    expect(pen.commands()).toEqual([{ op: "move", x: 1, y: 2 }, { op: "line", x: 3, y: 4 }, { op: "close" }]);
  });

  test("carries a curve's two control points and its end point apart", () => {
    expect(createPdfPen().curve(1, 2, 3, 4, 5, 6).commands()).toEqual([{ op: "curve", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 }]);
  });

  test("carries a rectangle whole, which is the one shape PDF has an operator for", () => {
    expect(draw(createPdfPen().rect(10, 100, 8, 30).commands())).toBe("10 712 8 30 re f");
  });
});

describe("a box takes a radius at each corner", () => {
  test("a radius of zero turns no corner, so every curve lands where the line before it ended", () => {
    const commands = roundedBoxCommands(0, 0, 100, 50, 0);
    const curves = commands.filter((command) => command.op === "curve");
    expect(curves).toHaveLength(4);
    expect(curves.every((curve) => curve.op === "curve" && curve.x1 === curve.x && curve.y1 === curve.y)).toBe(true);
  });

  test("each corner turns on its own radius rather than on one the box shares", () => {
    const commands = roundedBoxCommands(0, 0, 100, 100, { topLeft: 10, bottomRight: 4 });
    const lines = commands.filter((command) => command.op === "line");
    expect(lines[0]).toEqual({ op: "line", x: 96, y: 100 });
    expect(lines[2]).toEqual({ op: "line", x: 10, y: 0 });
  });

  test("`all` is what a corner naming no radius of its own takes", () => {
    expect(roundedBoxCommands(0, 0, 10, 10, { all: 3 })).toEqual(roundedBoxCommands(0, 0, 10, 10, 3));
  });

  test("closes, so the edge it started on is stroked as one run with the rest", () => {
    expect(roundedBoxCommands(0, 0, 10, 10, 2).at(-1)).toEqual({ op: "close" });
  });
});

describe("how a path is painted", () => {
  const square = createPdfPen().move(0, 0).line(10, 0).commands();

  test("fills by default, and a fill takes no pen width", () => {
    expect(draw(square)).toBe(`0 ${PAGE_HEIGHT} m 10 ${PAGE_HEIGHT} l f`);
  });

  test("a stroke names its weight first, which is what the operator after it uses", () => {
    expect(draw(square, { paint: "stroke", weight: 2 })).toBe(`2 w 0 ${PAGE_HEIGHT} m 10 ${PAGE_HEIGHT} l S`);
  });

  test("a path both filled and stroked paints once, rather than twice over itself", () => {
    expect(draw(square, { paint: "fill-stroke", weight: 1 })).toContain(" B");
  });
});

describe("a close before an operator that closes the path itself", () => {
  const closed = createPdfPen().move(0, 0).line(10, 0).close().commands();

  test("is dropped before a fill, which closes an open subpath on its own", () => {
    expect(draw(closed)).toBe(`0 ${PAGE_HEIGHT} m 10 ${PAGE_HEIGHT} l f`);
  });

  test("is kept before a stroke, which would otherwise leave the ends unjoined", () => {
    expect(draw(closed, { paint: "stroke", weight: 1 })).toBe(`1 w 0 ${PAGE_HEIGHT} m 10 ${PAGE_HEIGHT} l h S`);
  });

  test("is kept before a fill-stroke, whose stroke half does not close implicitly", () => {
    expect(draw(closed, { paint: "fill-stroke", weight: 1 })).toBe(`1 w 0 ${PAGE_HEIGHT} m 10 ${PAGE_HEIGHT} l h B`);
  });

  test("is dropped before a clip, which closes on the same winding rules a fill uses", () => {
    const shading = { kind: "axial", from: [0, 0], to: [10, 0], stops: STOPS } as const;
    expect(draw(closed, { shading })).toBe(`q 0 ${PAGE_HEIGHT} m 10 ${PAGE_HEIGHT} l W n /Sh0 sh Q`);
  });

  test("leaves no stray separator where the close was the whole path", () => {
    expect(draw(createPdfPen().close().commands())).toBe("f");
  });
});

describe("alpha and gradients", () => {
  test("alpha is bracketed, so a translucent path does not leave the page translucent", () => {
    const ops = draw(createPdfPen().move(0, 0).commands(), { alpha: 0.5 });
    expect(ops).toBe(`q /GS0 gs 0 ${PAGE_HEIGHT} m f Q`);
  });

  test("a gradient clips to the path and paints the shading through it, rather than filling", () => {
    const ops = draw(createPdfPen().move(0, 0).commands(), { shading: { kind: "axial", from: [0, 0], to: [10, 0], stops: STOPS } });
    expect(ops).toBe(`q 0 ${PAGE_HEIGHT} m W n /Sh0 sh Q`);
  });

  test("a gradient drawn at an alpha sets the state inside the same bracket", () => {
    const shading = { kind: "axial", from: [0, 0], to: [10, 0], stops: STOPS } as const;
    expect(draw(createPdfPen().move(0, 0).commands(), { alpha: 0.25, shading })).toContain("q /GS0 gs ");
  });
});
