import { describe, expect, test } from "bun:test";

import { createPdfFontSet } from "./set";
import type { PdfFontMetrics, PdfFontPack } from "./types";

const METRICS: PdfFontMetrics = {
  unitsPerEm: 1000,
  ascent: 750,
  descent: -250,
  bbox: [-100, -300, 1100, 1200],
  advances: new Map([[0x41, 667]]),
  glyphs: new Map([[0x41, 1]]),
};

const PACK: PdfFontPack = {
  family: "Inter",
  faces: [
    { family: "Inter", postScriptName: "Inter-Regular", weight: 400, style: "normal", stretch: 100, metrics: METRICS },
    { family: "Inter", postScriptName: "Inter-Bold", weight: 700, style: "normal", stretch: 100, metrics: METRICS },
  ],
};

describe("createPdfFontSet", () => {
  test("names the families it was given", () => {
    expect(createPdfFontSet([PACK]).families).toEqual(["Inter"]);
  });

  test("resolves a request to a concrete face", () => {
    const found = createPdfFontSet([PACK]).match({ family: "Inter", weight: 700 });
    expect(found.ok && found.data.weight).toBe(700);
  });

  test("fails by name for a family it does not carry", () => {
    const found = createPdfFontSet([PACK]).match({ family: "Georgia" });
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error.kind).toBe("unknown-family");
    expect(found.error.message).toContain("Georgia");
  });

  test("an empty set carries no family and resolves nothing", () => {
    const empty = createPdfFontSet([]);
    expect(empty.families).toEqual([]);
    expect(empty.match({ family: "Inter" }).ok).toBe(false);
  });
});
