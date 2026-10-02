import { embeddedWidth, linesOf, minimumWidth, preferredWidth, widestOf, wordsOf } from "./measure";
import { textWidth, wrapBy, wrapText } from "./text";
import type { PdfBaseFace, PdfDefaultFaces, PdfDocumentFonts, PdfEmbeddedFont, PdfTypesetting, TextStyle } from "./types";

// Every method delegates unchanged and `embedded` answers nothing, so naming a default face is what
// changes how a document is set — by construction rather than by each method remembering to.
/** The base-14 pair, which is what a document naming no default face is set in. @internal */
export const BASE14_TYPESETTING: PdfTypesetting = {
  width: (text, size, style = {}) => textWidth(text, size, style),
  wrap: (text, size, width, style = {}, breakWord = false) => wrapText(text, size, width, style, breakWord),
  preferred: (text, size, style = {}) => preferredWidth(text, size, style),
  minimum: (text, size, style = {}) => minimumWidth(text, size, style),
  embedded: () => undefined,
};

function embeddedTypesetting(regular: PdfEmbeddedFont, bold: PdfEmbeddedFont): PdfTypesetting {
  const faceFor = (style: TextStyle): PdfEmbeddedFont => (style.bold === true ? bold : regular);
  const width = (text: string, size: number, style: TextStyle = {}): number => embeddedWidth(text, size, faceFor(style).metrics, style);
  return {
    width,
    wrap: (text, size, at, style = {}, breakWord = false) => wrapBy(text, at, (run) => width(run, size, style), breakWord),
    // A run set on one line is the whole of it, and a paragraph's longest line is what it wants.
    preferred: (text, size, style = {}) => widestOf(linesOf(text), (line) => width(line, size, style)),
    minimum: (text, size, style = {}) => widestOf(wordsOf(text), (word) => width(word, size, style)),
    embedded: (of) => (of === "bold" ? bold : regular),
  };
}

/** What a document is set in, given the faces it carries and the pair it names as its default. @internal */
export function resolveTypesetting(fonts: PdfDocumentFonts | undefined, defaultFont: PdfDefaultFaces | undefined): PdfTypesetting {
  if (defaultFont === undefined) return BASE14_TYPESETTING;
  const named = (of: PdfBaseFace): PdfEmbeddedFont | undefined => fonts?.find((font) => font.name === defaultFont[of]);
  const [regular, bold] = [named("regular"), named("bold")];
  // The refusal is `prepare.ts`'s, and it runs before this: reaching here with either face missing
  // would emit a resource name no dictionary carries, so the base-14 pair is the safe answer.
  if (regular === undefined || bold === undefined) return BASE14_TYPESETTING;
  return embeddedTypesetting(regular, bold);
}
