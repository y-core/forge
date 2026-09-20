import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildMarks, svgPathCommands, svgToMark } from "./mark-build";
import type { MarkData } from "./types";

const ROOT = resolve(import.meta.dir, "../../..");

function wrapped(shapes: string): string {
  return `<svg viewBox="0 0 100 50">${shapes}</svg>`;
}

describe("an SVG path becomes the commands a renderer draws", () => {
  test("reads absolute moves and lines as they are written", () => {
    expect(svgPathCommands("M 10 20 L 30 40 Z")).toEqual([{ op: "move", x: 10, y: 20 }, { op: "line", x: 30, y: 40 }, { op: "close" }]);
  });

  test("resolves a relative command against the point before it", () => {
    expect(svgPathCommands("m 10 10 l 5 5")).toEqual([
      { op: "move", x: 10, y: 10 },
      { op: "line", x: 15, y: 15 },
    ]);
  });

  test("a horizontal or vertical line keeps the other coordinate it was already at", () => {
    expect(svgPathCommands("M 10 20 H 40 V 5")).toEqual([
      { op: "move", x: 10, y: 20 },
      { op: "line", x: 40, y: 20 },
      { op: "line", x: 40, y: 5 },
    ]);
  });

  test("a repeated coordinate pair after a move continues as a line, as SVG says it does", () => {
    expect(svgPathCommands("M 0 0 10 10 20 20")).toEqual([
      { op: "move", x: 0, y: 0 },
      { op: "line", x: 10, y: 10 },
      { op: "line", x: 20, y: 20 },
    ]);
  });

  test("a quadratic becomes the cubic that draws the same curve, since PDF has no quadratic", () => {
    expect(svgPathCommands("M 0 0 Q 30 0 30 30")).toEqual([
      { op: "move", x: 0, y: 0 },
      { op: "curve", x1: 20, y1: 0, x2: 30, y2: 10, x: 30, y: 30 },
    ]);
  });

  test("a smooth cubic reflects the control point before it rather than being given one", () => {
    const [, , smooth] = svgPathCommands("M 0 0 C 10 0 20 10 20 20 S 30 40 40 40");
    expect(smooth).toMatchObject({ op: "curve", x1: 20, y1: 30 });
  });

  test("closes back to the last point a move opened, not to the origin", () => {
    expect(svgPathCommands("M 5 5 L 9 9 Z L 7 7")).toEqual([
      { op: "move", x: 5, y: 5 },
      { op: "line", x: 9, y: 9 },
      { op: "close" },
      { op: "line", x: 7, y: 7 },
    ]);
  });

  test("declines an elliptical arc by name, and says what to export instead", () => {
    expect(() => svgPathCommands("M 0 0 A 5 5 0 0 1 10 10")).toThrow(/arcs flattened/);
  });
});

describe("the shapes an SVG draws besides a path", () => {
  test("a circle is four cubic arcs, closed, because PDF has no circle of its own", () => {
    const [drawn] = svgToMark(wrapped('<circle cx="50" cy="25" r="10" />')).paths;
    expect(drawn?.commands.filter((command) => command.op === "curve")).toHaveLength(4);
    expect(drawn?.commands[0]).toEqual({ op: "move", x: 60, y: 25 });
  });

  test("an ellipse turns on a radius per axis", () => {
    const [drawn] = svgToMark(wrapped('<ellipse cx="0" cy="0" rx="20" ry="10" />')).paths;
    expect(drawn?.commands[0]).toEqual({ op: "move", x: 20, y: 0 });
  });

  test("a rectangle is its four corners, so the artifact carries one kind of shape", () => {
    const [drawn] = svgToMark(wrapped('<rect x="1" y="2" width="4" height="8" />')).paths;
    expect(drawn?.commands).toEqual([
      { op: "move", x: 1, y: 2 },
      { op: "line", x: 5, y: 2 },
      { op: "line", x: 5, y: 10 },
      { op: "line", x: 1, y: 10 },
      { op: "close" },
    ]);
  });

  test("a polygon closes on the point it started from", () => {
    const [drawn] = svgToMark(wrapped('<polygon points="0,0 10,0 5,8" />')).paths;
    expect(drawn?.commands.at(-1)).toEqual({ op: "close" });
  });
});

describe("the paint a shape carries", () => {
  test("a hex fill becomes the device-RGB fractions a renderer sets", () => {
    expect(svgToMark(wrapped('<rect width="1" height="1" fill="#ff8000" />')).paths[0]?.fill).toEqual([1, 0x80 / 255, 0]);
  });

  test("a three-digit hex is the six-digit one it stands for", () => {
    expect(svgToMark(wrapped('<rect width="1" height="1" fill="#f00" />')).paths[0]?.fill).toEqual([1, 0, 0]);
  });

  test('fill="none" carries no fill, rather than a black one', () => {
    expect(svgToMark(wrapped('<rect width="1" height="1" fill="none" stroke="#000" />')).paths[0]?.fill).toBeUndefined();
  });

  test("a shape that names no fill takes black, which is what SVG's own default is", () => {
    expect(svgToMark(wrapped('<rect width="1" height="1" />')).paths[0]?.fill).toEqual([0, 0, 0]);
  });

  test("carries a stroke and its width where the shape is stroked", () => {
    const [drawn] = svgToMark(wrapped('<rect width="1" height="1" stroke="#fff" stroke-width="2.5" />')).paths;
    expect(drawn).toMatchObject({ stroke: [1, 1, 1], weight: 2.5 });
  });

  test("refuses a colour notation it does not read, rather than drawing it as black", () => {
    expect(() => svgToMark(wrapped('<rect width="1" height="1" fill="rebeccapurple" />'))).toThrow(/#rgb or #rrggbb/);
  });

  test("drops a shape painted neither way, which SVG draws nothing for", () => {
    const { paths } = svgToMark(wrapped('<rect width="1" height="1" fill="none" /><rect width="2" height="2" fill="#f00" />'));
    expect(paths).toHaveLength(1);
    expect(paths[0]?.fill).toEqual([1, 0, 0]);
  });

  test("an SVG whose every shape is painted neither way converts to nothing at all", () => {
    expect(() => svgToMark(wrapped('<rect width="1" height="1" fill="none" />'))).toThrow(/carries no shape/);
  });
});

describe("the coordinate space the artifact is drawn out of", () => {
  test("takes the viewBox, which is what a mark's own coordinates mean", () => {
    expect(svgToMark(wrapped('<rect width="1" height="1" />'))).toMatchObject({ width: 100, height: 50 });
  });

  test("falls back to the declared width and height where there is no viewBox", () => {
    expect(svgToMark('<svg width="40" height="20"><rect width="1" height="1" /></svg>')).toMatchObject({ width: 40, height: 20 });
  });

  test("refuses an SVG with no coordinate space at all", () => {
    expect(() => svgToMark('<svg><rect width="1" height="1" /></svg>')).toThrow(/coordinate space/);
  });

  test("refuses an SVG carrying no shape it converts", () => {
    expect(() => svgToMark(wrapped("<title>empty</title>"))).toThrow(/no shape/);
  });

  // This parser reads geometry and paint and nothing else, so a transform it silently dropped would
  // build clean and draw the mark at the wrong place and the wrong scale.
  test("refuses a transform on a shape, rather than dropping the geometry it carries", () => {
    expect(() => svgToMark(wrapped('<rect width="1" height="1" transform="translate(10 10)" />'))).toThrow(/transform is not composited/);
  });

  test("refuses a transform on an enclosing group, which this parser never even reads", () => {
    expect(() => svgToMark(wrapped('<g transform="scale(2)"><rect width="1" height="1" /></g>'))).toThrow(/transform is not composited/);
  });
});

describe("what the build step writes", () => {
  test("converts each configured SVG into an artifact under the asset root", () => {
    const out = mkdtempSync(join(tmpdir(), "forge-marks-"));
    buildMarks([{ from: "tests/fixtures/mark/mark.svg", to: "marks/letterhead.json" }], ROOT, out);
    const written = JSON.parse(readFileSync(join(out, "marks/letterhead.json"), "utf-8")) as MarkData;
    expect(written.paths.length).toBeGreaterThan(0);
  });

  test("the committed artifact is what converting its own SVG produces", () => {
    const svg = readFileSync(join(ROOT, "tests/fixtures/mark/mark.svg"), "utf-8");
    const committed = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/mark/mark.json"), "utf-8")) as MarkData;
    expect(svgToMark(svg)).toEqual(committed);
  });
});
