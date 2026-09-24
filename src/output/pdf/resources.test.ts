import { describe, expect, test } from "bun:test";

import { PAGE_HEIGHT } from "./geometry";
import { createPdfResources } from "./resources";
import type { PdfShading, PdfShadingStops } from "./types";

const FONTS = "/F1 3 0 R /F2 4 0 R";

const STOPS: PdfShadingStops = [
  { at: 0, ink: [1, 0, 0] },
  { at: 1, ink: [0, 0, 1] },
];

const AXIAL: PdfShading = { kind: "axial", from: [0, 100], to: [200, 100], stops: STOPS };

describe("a document of solid inks declares nothing it does not use", () => {
  test("names only its fonts, which is what keeps an opaque document's bytes where they were", () => {
    expect(createPdfResources(PAGE_HEIGHT).dictionary(FONTS)).toBe(`<< /Font << ${FONTS} >> >>`);
  });
});

describe("graphics states", () => {
  test("one alpha is one state however many paths reach for it", () => {
    const resources = createPdfResources(PAGE_HEIGHT);
    expect([resources.alpha(0.5), resources.alpha(0.5)]).toEqual(["GS0", "GS0"]);
    expect(resources.dictionary(FONTS)).toContain("/ExtGState << /GS0 << /Type /ExtGState /ca 0.5 /CA 0.5 >> >>");
  });

  test("a second alpha is a second state, named in the order it was first reached for", () => {
    const resources = createPdfResources(PAGE_HEIGHT);
    expect([resources.alpha(0.5), resources.alpha(0.25)]).toEqual(["GS0", "GS1"]);
  });

  test("sets the stroke and the fill alike, since a path may be both", () => {
    const resources = createPdfResources(PAGE_HEIGHT);
    resources.alpha(0.4);
    expect(resources.dictionary(FONTS)).toContain("/ca 0.4 /CA 0.4");
  });
});

describe("gradients", () => {
  test("flips its coordinates into user space exactly as the path it fills does", () => {
    const resources = createPdfResources(PAGE_HEIGHT);
    resources.shading(AXIAL);
    expect(resources.dictionary(FONTS)).toContain(`/Coords [0 ${PAGE_HEIGHT - 100} 200 ${PAGE_HEIGHT - 100}]`);
  });

  test("two stops are one ramp between two inks", () => {
    const resources = createPdfResources(PAGE_HEIGHT);
    resources.shading(AXIAL);
    expect(resources.dictionary(FONTS)).toContain("/FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1");
  });

  test("a third stop stitches a ramp per interval, bounded at the stops between them", () => {
    const resources = createPdfResources(PAGE_HEIGHT);
    resources.shading({ ...AXIAL, stops: [STOPS[0], { at: 0.3, ink: [0, 1, 0] }, STOPS[1]] });
    const dictionary = resources.dictionary(FONTS);
    expect(dictionary).toContain("/FunctionType 3");
    expect(dictionary).toContain("/Bounds [0.3]");
    expect(dictionary).toContain("/Encode [0 1 0 1]");
  });

  test("orders its stops itself, so a scheme written out of order still ramps in order", () => {
    const resources = createPdfResources(PAGE_HEIGHT);
    resources.shading({ ...AXIAL, stops: [STOPS[1], STOPS[0]] });
    expect(resources.dictionary(FONTS)).toContain("/C0 [1 0 0] /C1 [0 0 1]");
  });

  test("a radial gradient carries a radius with each of its two centres", () => {
    const resources = createPdfResources(PAGE_HEIGHT);
    resources.shading({ kind: "radial", from: [50, 50, 0], to: [50, 50, 20], stops: STOPS });
    const dictionary = resources.dictionary(FONTS);
    expect(dictionary).toContain("/ShadingType 3");
    expect(dictionary).toContain(`/Coords [50 ${PAGE_HEIGHT - 50} 0 50 ${PAGE_HEIGHT - 50} 20]`);
  });

  test("the same gradient twice is one entry, and a different one is a second", () => {
    const resources = createPdfResources(PAGE_HEIGHT);
    expect([resources.shading(AXIAL), resources.shading({ ...AXIAL })]).toEqual(["Sh0", "Sh0"]);
    expect(resources.shading({ ...AXIAL, to: [300, 100] })).toBe("Sh1");
  });
});
