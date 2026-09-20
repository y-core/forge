import type { PdfEmbeddedFont } from "../types";
import { readPdfFontMetrics } from "./pack";
import type { PdfFontPackData } from "./types";

// Every value crosses unscaled: `embedFont` is the one place that turns font units into the
// 1000-unit em a descriptor declares, and scaling here too shrinks every face above 1000 upem.
/** A pack as the asset pipeline writes it, turned into the faces a document embeds. @public */
export function readPdfEmbeddedFonts(
  data: PdfFontPackData,
  sfnt: (path: string) => Uint8Array,
  name: (face: PdfFontPackData["faces"][number]) => string,
): readonly PdfEmbeddedFont[] {
  return data.faces.map((face) => {
    const metrics = readPdfFontMetrics(face.metrics);
    return { name: name(face), postScriptName: face.postScriptName, sfnt: sfnt(face.sfnt), glyphs: metrics.glyphs, metrics };
  });
}
