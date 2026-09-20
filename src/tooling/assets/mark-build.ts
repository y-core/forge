import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { safeJoin } from "./paths";
import type { MarkBuild, MarkCommandData, MarkData, MarkPathData } from "./types";

// The Bézier constant that makes four cubic arcs approximate a circle, which is how an ellipse
// reaches a renderer that has no circle primitive of its own.
const KAPPA = 0.5523;

const SEGMENTS = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
const NUMBERS = /-?\d*\.?\d+(?:e[+-]?\d+)?/gi;
const ELEMENTS = /<(path|circle|ellipse|rect|polygon)\b([^>]*)>/gi;

function attribute(attributes: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(attributes)?.[1];
}

function numbers(text: string): number[] {
  return (text.match(NUMBERS) ?? []).map(Number);
}

function ink(value: string | undefined, fallback: [number, number, number] | undefined): [number, number, number] | undefined {
  if (value === undefined) return fallback;
  if (value.toLowerCase() === "none") return undefined;
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (hex === null) throw new Error(`svgToMark: ${value} is not a colour this step reads — write it as #rgb or #rrggbb`);
  const digits = hex[1] ?? "";
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255) as [number, number, number];
}

interface Pen {
  commands: MarkCommandData[];
  x: number;
  y: number;
  startX: number;
  startY: number;
  /** The reflected control point `S` and `T` continue from, which is the current point after any other command. */
  controlX: number;
  controlY: number;
}

function cubic(pen: Pen, x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
  pen.commands.push({ op: "curve", x1, y1, x2, y2, x, y });
  [pen.x, pen.y, pen.controlX, pen.controlY] = [x, y, x2, y2];
}

// A quadratic is one cubic whose controls sit two thirds of the way along each of its legs; PDF has
// no quadratic operator, so the conversion happens here rather than at render time.
function quadratic(pen: Pen, cx: number, cy: number, x: number, y: number): void {
  const [x1, y1] = [pen.x + (2 / 3) * (cx - pen.x), pen.y + (2 / 3) * (cy - pen.y)];
  const [x2, y2] = [x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y)];
  pen.commands.push({ op: "curve", x1, y1, x2, y2, x, y });
  [pen.x, pen.y, pen.controlX, pen.controlY] = [x, y, cx, cy];
}

function moveOrLine(pen: Pen, op: "move" | "line", x: number, y: number): void {
  pen.commands.push({ op, x, y });
  [pen.x, pen.y, pen.controlX, pen.controlY] = [x, y, x, y];
  if (op === "move") [pen.startX, pen.startY] = [x, y];
}

function step(pen: Pen, letter: string, args: number[], at: number): number {
  const relative = letter === letter.toLowerCase();
  const [dx, dy] = relative ? [pen.x, pen.y] : [0, 0];
  const value = (index: number, offset: number): number => (args[at + index] ?? 0) + offset;
  switch (letter.toUpperCase()) {
    case "M":
      moveOrLine(pen, at === 0 ? "move" : "line", value(0, dx), value(1, dy));
      return 2;
    case "L":
      moveOrLine(pen, "line", value(0, dx), value(1, dy));
      return 2;
    case "H":
      moveOrLine(pen, "line", value(0, dx), pen.y);
      return 1;
    case "V":
      moveOrLine(pen, "line", pen.x, value(0, dy));
      return 1;
    case "C":
      cubic(pen, value(0, dx), value(1, dy), value(2, dx), value(3, dy), value(4, dx), value(5, dy));
      return 6;
    case "S":
      cubic(pen, 2 * pen.x - pen.controlX, 2 * pen.y - pen.controlY, value(0, dx), value(1, dy), value(2, dx), value(3, dy));
      return 4;
    case "Q":
      quadratic(pen, value(0, dx), value(1, dy), value(2, dx), value(3, dy));
      return 2 + 2;
    case "T":
      quadratic(pen, 2 * pen.x - pen.controlX, 2 * pen.y - pen.controlY, value(0, dx), value(1, dy));
      return 2;
    case "A":
      throw new Error("svgToMark: an elliptical arc is not converted — export the mark with its arcs flattened to curves");
    default:
      pen.commands.push({ op: "close" });
      [pen.x, pen.y] = [pen.startX, pen.startY];
      return 0;
  }
}

/** One SVG `d` attribute as the commands a renderer draws, with every curve already cubic. @public */
export function svgPathCommands(d: string): MarkCommandData[] {
  const pen: Pen = { commands: [], x: 0, y: 0, startX: 0, startY: 0, controlX: 0, controlY: 0 };
  for (const [, letter = "", body = ""] of d.matchAll(SEGMENTS)) {
    const args = numbers(body);
    let at = 0;
    // A command letter carries as many argument sets as follow it, and a repeated `M` continues as
    // an implicit `L` — which is why the first set is told apart from the rest.
    do at += step(pen, letter, args, at);
    while (at < args.length && at > 0);
  }
  return pen.commands;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): MarkCommandData[] {
  const [kx, ky] = [rx * KAPPA, ry * KAPPA];
  return [
    { op: "move", x: cx + rx, y: cy },
    { op: "curve", x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
    { op: "curve", x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
    { op: "curve", x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
    { op: "curve", x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
    { op: "close" },
  ];
}

function polygon(points: number[]): MarkCommandData[] {
  const corners: MarkCommandData[] = [];
  for (let at = 0; at + 1 < points.length; at += 2) {
    corners.push({ op: corners.length === 0 ? "move" : "line", x: points[at] ?? 0, y: points[at + 1] ?? 0 });
  }
  return [...corners, { op: "close" }];
}

function commandsFor(element: string, attributes: string): MarkCommandData[] {
  if (element === "path") return svgPathCommands(attribute(attributes, "d") ?? "");
  const at = (name: string): number => Number(attribute(attributes, name) ?? 0);
  if (element === "circle") return ellipse(at("cx"), at("cy"), at("r"), at("r"));
  if (element === "ellipse") return ellipse(at("cx"), at("cy"), at("rx"), at("ry"));
  if (element === "polygon") return polygon(numbers(attribute(attributes, "points") ?? ""));
  const [x, y, width, height] = [at("x"), at("y"), at("width"), at("height")];
  return [
    { op: "move", x, y },
    { op: "line", x: x + width, y },
    { op: "line", x: x + width, y: y + height },
    { op: "line", x, y: y + height },
    { op: "close" },
  ];
}

function viewBox(svg: string): { width: number; height: number } {
  // The root element only: a shape inside it carries a `width` of its own, and reading that one
  // would size the artwork to whichever shape happened to be written first.
  const root = /<svg\b([^>]*)>/i.exec(svg)?.[1] ?? "";
  const box = numbers(attribute(root, "viewBox") ?? "");
  if (box.length === 4) return { width: box[2] ?? 0, height: box[3] ?? 0 };
  const sized = { width: Number(attribute(root, "width") ?? 0), height: Number(attribute(root, "height") ?? 0) };
  if (sized.width > 0 && sized.height > 0) return sized;
  throw new Error("svgToMark: the SVG declares neither a viewBox nor a width and height, so it has no coordinate space");
}

/** An SVG as the paths a renderer draws, so no Worker ever parses XML to put a mark on a page. @public */
export function svgToMark(svg: string): MarkData {
  const paths: MarkPathData[] = [];
  // A transform is geometry this parser does not read, and a mark carrying one would build clean and
  // draw at the wrong place and scale — so it is refused rather than composited.
  if (/\btransform\s*=/i.test(svg)) {
    throw new Error("svgToMark: a transform is not composited — export the mark with its transforms baked into the coordinates");
  }
  for (const [, element = "", attributes = ""] of svg.matchAll(ELEMENTS)) {
    const fill = ink(attribute(attributes, "fill"), [0, 0, 0]);
    const stroke = ink(attribute(attributes, "stroke"), undefined);
    const weight = attribute(attributes, "stroke-width");
    // `fill="none"` with no stroke draws nothing in SVG, and a renderer choosing its paint mode from
    // the stroke alone would fill it. Dropping it here is what the source already means.
    if (fill === undefined && stroke === undefined) continue;
    paths.push({
      commands: commandsFor(element.toLowerCase(), attributes),
      ...(fill === undefined ? {} : { fill }),
      ...(stroke === undefined ? {} : { stroke }),
      ...(weight === undefined ? {} : { weight: Number(weight) }),
    });
  }
  if (paths.length === 0) throw new Error("svgToMark: the SVG carries no shape this step converts");
  return { ...viewBox(svg), paths };
}

/** Converts each configured SVG into the artifact a renderer draws, under the asset root. @public */
export function buildMarks(marks: readonly MarkBuild[], root: string, publicDir: string): void {
  for (const mark of marks) {
    const data = svgToMark(readFileSync(safeJoin(root, mark.from), "utf-8"));
    const to = safeJoin(publicDir, mark.to);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, `${JSON.stringify(data, null, 2)}\n`);
  }
}
