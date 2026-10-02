import type { PdfFontMetrics, PdfFontPack, PdfFontPackData } from "./types";

/** The pack's string-keyed records turned into the maps the engine reads, values untouched. @internal */
export function readPdfFontMetrics(data: PdfFontPackData["faces"][number]["metrics"]): PdfFontMetrics {
  return {
    unitsPerEm: data.unitsPerEm,
    ascent: data.ascent,
    descent: data.descent,
    bbox: data.bbox,
    advances: new Map(Object.entries(data.advances).map(([code, advance]) => [Number(code), advance])),
    glyphs: new Map(Object.entries(data.glyphs).map(([code, glyph]) => [Number(code), glyph])),
    kerning: new Map(Object.entries(data.kerning)),
  };
}

// The artifact is the contract between the build step and the engine: plain JSON, so neither
// namespace names the other's types and the file on disk is what has to stay in step.
/** A pack as the asset pipeline writes it, turned into the faces a font set matches against. @public */
export function readPdfFontPack(data: PdfFontPackData, sfnt: (path: string) => Uint8Array | undefined): PdfFontPack {
  return {
    family: data.family,
    faces: data.faces.map((face) => {
      const bytes = sfnt(face.sfnt);
      return {
        family: data.family,
        postScriptName: face.postScriptName,
        weight: face.weight,
        style: face.style,
        stretch: face.stretch,
        metrics: readPdfFontMetrics(face.metrics),
        ...(bytes === undefined ? {} : { sfnt: bytes }),
      };
    }),
  };
}
