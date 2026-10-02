import { describe, expect, test } from "bun:test";

import { readPdfFontPack } from "./pack";
import { createPdfFontSet } from "./set";
import type { PdfFontPackData } from "./types";

const DATA: PdfFontPackData = {
  family: "Oswald",
  faces: [
    {
      postScriptName: "Oswald-Regular",
      weight: 400,
      style: "normal",
      stretch: 100,
      sfnt: "fonts/oswald-400.ttf",
      metrics: {
        unitsPerEm: 1000,
        ascent: 1193,
        descent: -289,
        bbox: [0, 0, 1000, 1000],
        advances: { "65": 527, "86": 500 },
        glyphs: { "65": 3, "86": 4 },
        kerning: { "65,86": -39 },
      },
    },
    {
      postScriptName: "Oswald-Bold",
      weight: 700,
      style: "normal",
      stretch: 100,
      sfnt: "fonts/oswald-700.ttf",
      metrics: {
        unitsPerEm: 1000,
        ascent: 1193,
        descent: -289,
        bbox: [-100, -300, 1100, 1200],
        advances: { "65": 560 },
        glyphs: { "65": 3 },
        kerning: {},
      },
    },
  ],
};

const BYTES = new Uint8Array([0x00, 0x01, 0x00, 0x00]);

describe("readPdfFontPack", () => {
  const pack = readPdfFontPack(DATA, () => BYTES);

  test("turns the artifact's string-keyed advances into the map the engine measures through", () => {
    expect(pack.faces[0]?.metrics.advances.get(0x41)).toBe(527);
    expect(pack.faces[0]?.metrics.advances.get(0x56)).toBe(500);
  });

  test("carries the kerning pairs across under the same key the build wrote", () => {
    expect(pack.faces[0]?.metrics.kerning?.get("65,86")).toBe(-39);
    expect(pack.faces[1]?.metrics.kerning?.size).toBe(0);
  });

  test("attaches the bytes the loader resolved, and leaves the face without them where it cannot", () => {
    expect(pack.faces[0]?.sfnt).toEqual(BYTES);
    expect(readPdfFontPack(DATA, () => undefined).faces[0]?.sfnt).toBeUndefined();
  });

  test("keeps every face's own weight, style and stretch", () => {
    expect(pack.faces.map((face) => face.weight)).toEqual([400, 700]);
    expect(pack.faces.every((face) => face.family === "Oswald")).toBe(true);
  });
});

describe("the artifact is what the two halves meet on", () => {
  test("a pack read from the pipeline's output is accepted by createPdfFontSet", () => {
    const set = createPdfFontSet([readPdfFontPack(DATA, () => BYTES)]);
    expect(set.families).toEqual(["Oswald"]);
    const bold = set.match({ family: "Oswald", weight: 700 });
    expect(bold.ok && bold.data.weight).toBe(700);
    expect(bold.ok && bold.data.metrics.advances.get(0x41)).toBe(560);
  });
});
