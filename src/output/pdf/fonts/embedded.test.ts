import { describe, expect, test } from "bun:test";

import { embedFont } from "../embed";
import { createObjectManager } from "../writer";
import { readPdfEmbeddedFonts } from "./embedded";
import type { PdfFontPackData } from "./types";

// 2048 is the usual TrueType em square, and the one a pass-through bug hides behind: at 1000 a
// second scale is ×1, so only a face above the PDF's own em square can catch it.
const UPEM = 2048;
const BBOX = [-1024, -512, 3072, 2048] as const;

const DATA: PdfFontPackData = {
  family: "Inter",
  faces: [
    {
      postScriptName: "Inter-Regular",
      weight: 400,
      style: "normal",
      stretch: 100,
      sfnt: "fonts/inter-400.ttf",
      metrics: {
        unitsPerEm: UPEM,
        ascent: 2048,
        descent: -512,
        bbox: BBOX,
        advances: { "65": 667 },
        glyphs: { "65": 3 },
        kerning: { "65,86": -39 },
      },
    },
  ],
};

const BYTES = new Uint8Array([0x00, 0x01, 0x00, 0x00]);
const [FACE] = readPdfEmbeddedFonts(
  DATA,
  () => BYTES,
  () => "body",
);

describe("readPdfEmbeddedFonts", () => {
  test("names the face what the caller calls it and the file what the face calls itself", () => {
    expect(FACE?.name).toBe("body");
    expect(FACE?.postScriptName).toBe("Inter-Regular");
  });

  test("turns the artifact's string-keyed records into the maps the writer addresses", () => {
    expect(FACE?.glyphs.get(0x41)).toBe(3);
    expect(FACE?.metrics.advances.get(0x41)).toBe(667);
    expect(FACE?.metrics.kerning?.get("65,86")).toBe(-39);
    expect(FACE?.sfnt).toEqual(BYTES);
  });

  test("carries the bounding box across in font units, leaving the em square as the pack states it", () => {
    expect(FACE?.metrics.bbox).toEqual(BBOX);
    expect(FACE?.metrics.unitsPerEm).toBe(UPEM);
    expect(FACE?.metrics.ascent).toBe(2048);
  });

  // A descriptor is written in a 1000-unit em whatever the face's own is (PDF 32000-1 §9.8.1), so
  // the one scale the pipeline applies is `embedFont`'s. Scaling in the adapter too shrinks the box.
  test("so the descriptor a reader sees is the box scaled once, by 1000 over the face's em square", () => {
    const manager = createObjectManager();
    if (FACE === undefined) throw new Error("the pack yielded no face");
    embedFont(manager, FACE, manager.reserve());
    const written = manager
      .objects()
      .map((object) => (typeof object.body === "string" ? object.body : object.body.head))
      .join("\n");
    expect(written).toContain(`/FontBBox [${BBOX.map((edge) => (edge * 1000) / UPEM).join(" ")}]`);
  });
});
