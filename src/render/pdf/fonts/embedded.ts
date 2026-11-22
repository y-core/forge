import { ok } from "../../../result/result";
import type { PdfEmbeddedFont, PdfResult } from "../types";
import { checkPdfFontPack, readPdfFontMetrics } from "./pack";
import type { PdfFontPackData } from "./types";

// Every value crosses unscaled: `embedFont` is the one place that turns font units into the
// 1000-unit em a descriptor declares, and scaling here too shrinks every face above 1000 upem.
/** A parsed pack as the faces a document embeds, or a refusal naming the malformed field; call it once per load, at module scope. @public */
export function readPdfEmbeddedFonts(
  data: unknown,
  sfnt: (path: string) => Uint8Array,
  name: (face: PdfFontPackData["faces"][number]) => string,
): PdfResult<readonly PdfEmbeddedFont[]> {
  const checked = checkPdfFontPack(data);
  if (!checked.ok) return checked;
  return ok(
    checked.data.faces.map((face) => {
      const metrics = readPdfFontMetrics(face.metrics);
      return { name: name(face), postScriptName: face.postScriptName, sfnt: sfnt(face.sfnt), glyphs: metrics.glyphs, metrics };
    }),
  );
}
