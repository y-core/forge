import { describe, expect, test } from "bun:test";

import type { PdfRenderError } from "../types";
import { readPdfFontPack } from "./pack";
import { createPdfFontSet } from "./set";
import type { PdfFontPack, PdfFontPackData } from "./types";

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

function read(data: unknown, sfnt: (path: string) => Uint8Array | undefined = () => BYTES): PdfFontPack {
  const result = readPdfFontPack(data, sfnt);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function refusalOf(data: unknown): PdfRenderError {
  const result = readPdfFontPack(data, () => BYTES);
  if (result.ok) throw new Error("the pack was accepted");
  return result.error;
}

function withMetrics(metrics: Record<string, unknown>): unknown {
  const [face] = DATA.faces;
  return { ...DATA, faces: [{ ...face, metrics: { ...face?.metrics, ...metrics } }] };
}

describe("readPdfFontPack", () => {
  const pack = read(DATA);

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
    expect(read(DATA, () => undefined).faces[0]?.sfnt).toBeUndefined();
  });

  test("keeps every face's own weight, style and stretch", () => {
    expect(pack.faces.map((face) => face.weight)).toEqual([400, 700]);
    expect(pack.faces.every((face) => face.family === "Oswald")).toBe(true);
  });
});

describe("the artifact is what the two halves meet on", () => {
  test("a pack read from the pipeline's output is accepted by createPdfFontSet", () => {
    const set = createPdfFontSet([read(DATA)]);
    expect(set.families).toEqual(["Oswald"]);
    const bold = set.match({ family: "Oswald", weight: 700 });
    expect(bold.ok && bold.data.weight).toBe(700);
    expect(bold.ok && bold.data.metrics.advances.get(0x41)).toBe(560);
  });
});

describe("readPdfFontPack refuses a pack the engine cannot read", () => {
  test("refuses a value that is not a pack at all, naming no field", () => {
    expect(refusalOf("packs.json")).toEqual({ kind: "font-pack", message: "the font pack is malformed" });
    expect(refusalOf(null).kind).toBe("font-pack");
  });

  test("refuses a pack without a family", () => {
    expect(refusalOf({ faces: DATA.faces }).message).toBe("the font pack is malformed at family");
  });

  test("refuses each face field the engine reads when it is the wrong type, naming it", () => {
    const [face] = DATA.faces;
    const cases: { input: unknown; expected: string }[] = [
      { input: { ...DATA, faces: "Oswald-Regular" }, expected: "the font pack is malformed at faces" },
      { input: { ...DATA, faces: [{ ...face, postScriptName: 7 }] }, expected: "the font pack is malformed at faces.0.postScriptName" },
      { input: { ...DATA, faces: [{ ...face, weight: Number.NaN }] }, expected: "the font pack is malformed at faces.0.weight" },
      { input: { ...DATA, faces: [{ ...face, stretch: Number.POSITIVE_INFINITY }] }, expected: "the font pack is malformed at faces.0.stretch" },
      { input: { ...DATA, faces: [{ ...face, sfnt: undefined }] }, expected: "the font pack is malformed at faces.0.sfnt" },
      { input: { ...DATA, faces: [{ ...face, metrics: undefined }] }, expected: "the font pack is malformed at faces.0.metrics" },
      { input: withMetrics({ glyphs: { "65": Number.POSITIVE_INFINITY } }), expected: "the font pack is malformed at faces.0.metrics.glyphs" },
      { input: withMetrics({ kerning: { "65,86": Number.NaN } }), expected: "the font pack is malformed at faces.0.metrics.kerning" },
      { input: withMetrics({ unitsPerEm: 0 }), expected: "the font pack is malformed at faces.0.metrics.unitsPerEm" },
      { input: withMetrics({ unitsPerEm: -1000 }), expected: "the font pack is malformed at faces.0.metrics.unitsPerEm" },
    ];
    expect(cases.map(({ input }) => refusalOf(input))).toEqual(cases.map(({ expected }) => ({ kind: "font-pack", message: expected })));
  });

  test("refuses a style outside the three a face can have", () => {
    const [face] = DATA.faces;
    expect(refusalOf({ ...DATA, faces: [{ ...face, style: "bold" }] }).message).toBe("the font pack is malformed at faces.0.style");
  });

  test("refuses a metric that is not finite", () => {
    expect(refusalOf(withMetrics({ unitsPerEm: Number.NaN })).message).toBe("the font pack is malformed at faces.0.metrics.unitsPerEm");
    expect(refusalOf(withMetrics({ ascent: Number.POSITIVE_INFINITY })).message).toBe("the font pack is malformed at faces.0.metrics.ascent");
  });

  test("refuses a bounding box that is not exactly four finite edges", () => {
    expect(refusalOf(withMetrics({ bbox: [0, 0, 1000] })).message).toBe("the font pack is malformed at faces.0.metrics.bbox.3");
    expect(refusalOf(withMetrics({ bbox: [0, 0, 1000, 1000, 0] })).message).toBe("the font pack is malformed at faces.0.metrics.bbox.4");
    expect(refusalOf(withMetrics({ bbox: [0, 0, 1000, Number.NaN] })).message).toBe("the font pack is malformed at faces.0.metrics.bbox.3");
  });

  test("refuses an advance or a glyph keyed by anything but a code point", () => {
    expect(refusalOf(withMetrics({ advances: { A: 527 } })).message).toBe("the font pack is malformed at faces.0.metrics.advances");
    expect(refusalOf(withMetrics({ glyphs: { "-1": 3 } })).message).toBe("the font pack is malformed at faces.0.metrics.glyphs");
  });

  test.each(["065", "1114112"])("refuses a record key %p, which is not a canonical decimal code point", (key) => {
    expect(refusalOf(withMetrics({ advances: { [key]: 527 } })).message).toBe("the font pack is malformed at faces.0.metrics.advances");
    expect(refusalOf(withMetrics({ glyphs: { [key]: 3 } })).message).toBe("the font pack is malformed at faces.0.metrics.glyphs");
    expect(refusalOf(withMetrics({ kerning: { [`${key},86`]: -39 } })).message).toBe("the font pack is malformed at faces.0.metrics.kerning");
    expect(refusalOf(withMetrics({ kerning: { [`86,${key}`]: -39 } })).message).toBe("the font pack is malformed at faces.0.metrics.kerning");
  });

  test.each([
    { key: "0", code: 0 },
    { key: "65", code: 65 },
    { key: "1114111", code: 0x10ffff },
  ])("accepts the code point key $key", ({ key, code }) => {
    const metrics = read(withMetrics({ advances: { [key]: 527 }, glyphs: { [key]: 3 }, kerning: { [`${key},${key}`]: -39 } })).faces[0]?.metrics;
    expect(metrics?.advances.get(code)).toBe(527);
    expect(metrics?.glyphs.get(code)).toBe(3);
    expect(metrics?.kerning?.get(`${key},${key}`)).toBe(-39);
  });

  test("refuses a kerning pair keyed by anything but two code points", () => {
    expect(refusalOf(withMetrics({ kerning: { "65": -39 } })).message).toBe("the font pack is malformed at faces.0.metrics.kerning");
  });

  test("refuses a record value that is not finite", () => {
    expect(refusalOf(withMetrics({ advances: { "65": "527" } })).message).toBe("the font pack is malformed at faces.0.metrics.advances");
  });

  test("cuts the field at the record, so no key the input carries reaches the message", () => {
    const { message } = refusalOf(withMetrics({ kerning: { "<script>": -39 }, advances: { "65": Number.NaN } }));
    expect(message).not.toContain("<script>");
    expect(message).not.toContain("65");
  });
});
