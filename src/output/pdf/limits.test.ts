import { describe, expect, test } from "bun:test";

import { DEFAULT_PDF_MAX_PAGES, pdfTaggingOn } from "./limits";
import type { PdfEmbeddedFont } from "./types";

const FACE = { name: "body", postScriptName: "Body" } as unknown as PdfEmbeddedFont;

describe("DEFAULT_PDF_MAX_PAGES", () => {
  test("leaves more than an order of magnitude of headroom over a two-page declaration", () => {
    expect(DEFAULT_PDF_MAX_PAGES).toBeGreaterThan(20);
  });

  test("is a whole number of pages", () => {
    expect(Number.isInteger(DEFAULT_PDF_MAX_PAGES)).toBe(true);
  });
});

describe("pdfTaggingOn", () => {
  test("follows the faces where the caller names nothing: on with one to embed, off without", () => {
    expect(pdfTaggingOn({ fonts: [FACE] })).toBe(true);
    expect(pdfTaggingOn({})).toBe(false);
    expect(pdfTaggingOn({ fonts: [] })).toBe(false);
  });

  test("takes an explicit answer over the faces, in either direction", () => {
    expect(pdfTaggingOn({ tagged: false, fonts: [FACE] })).toBe(false);
    expect(pdfTaggingOn({ tagged: true })).toBe(true);
  });
});
