import { describe, expect, test } from "bun:test";

import { matchFace } from "./match";
import type { PdfFace, PdfFontMetrics, PdfFontStretch, PdfFontStyle } from "./types";

const METRICS: PdfFontMetrics = {
  unitsPerEm: 1000,
  ascent: 750,
  descent: -250,
  bbox: [-100, -300, 1100, 1200],
  advances: new Map([[0x41, 667]]),
  glyphs: new Map([[0x41, 1]]),
};

function face(weight: number, style: PdfFontStyle = "normal", stretch: PdfFontStretch = 100): PdfFace {
  return { family: "Inter", postScriptName: "Inter-Regular", weight, style, stretch, metrics: METRICS };
}

function weightOf(faces: readonly PdfFace[], weight: number): number | undefined {
  const found = matchFace(faces, { family: "Inter", weight });
  return found.ok ? found.data.weight : undefined;
}

describe("the ladder walks stretch, then style, then weight", () => {
  test("a narrower stretch is preferred for a narrow request, a wider one for a wide request", () => {
    const faces = [face(400, "normal", 75), face(400, "normal", 125)];
    const narrow = matchFace(faces, { family: "Inter", stretch: 90 });
    const wide = matchFace(faces, { family: "Inter", stretch: 110 });
    expect(narrow.ok && narrow.data.stretch).toBe(75);
    expect(wide.ok && wide.data.stretch).toBe(125);
  });

  test("an earlier axis rules a face out before a later one can reach it", () => {
    // The bold is condensed; the request is normal width, so weight cannot pull the condensed face in.
    const faces = [face(400, "normal", 100), face(700, "normal", 75)];
    const found = matchFace(faces, { family: "Inter", weight: 700 });
    expect(found.ok && found.data.stretch).toBe(100);
    expect(found.ok && found.data.weight).toBe(400);
  });
});

describe("weight matching follows the CSS rules", () => {
  const ladder = [face(100), face(400), face(500), face(700), face(900)];

  test("takes an exact weight where the family ships one", () => {
    expect(weightOf(ladder, 700)).toBe(700);
  });

  test("between 400 and 500, looks up first but no further than 500", () => {
    expect(weightOf([face(300), face(500), face(900)], 400)).toBe(500);
    expect(weightOf([face(300), face(900)], 450)).toBe(300);
  });

  test("below 400, looks down before up", () => {
    expect(weightOf([face(200), face(600)], 300)).toBe(200);
    expect(weightOf([face(600), face(900)], 300)).toBe(600);
  });

  test("above 500, looks up before down", () => {
    expect(weightOf([face(400), face(900)], 700)).toBe(900);
    expect(weightOf([face(300), face(400)], 700)).toBe(400);
  });
});

describe("a missing style fails by name, and is never synthesised", () => {
  test("a requested italic the family does not ship is an error, not a sheared roman", () => {
    const found = matchFace([face(400, "normal")], { family: "Inter", style: "italic" });
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error.kind).toBe("no-style");
    expect(found.error.message).toContain("italic");
  });

  test("an oblique stands in for an italic where one exists, since it is a real face", () => {
    const found = matchFace([face(400, "oblique")], { family: "Inter", style: "italic" });
    expect(found.ok && found.data.style).toBe("oblique");
  });

  test("a normal request never falls through to an italic", () => {
    const found = matchFace([face(400, "italic")], { family: "Inter", style: "normal" });
    expect(found.ok).toBe(false);
  });
});
