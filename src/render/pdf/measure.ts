import { textWidth } from "./text";
import type { PdfBox, PdfElement, PdfEmbeddedMetrics, PdfTypesetting, TextStyle } from "./types";

/** What a run occupies in an embedded face, kerned, at the size it is set in. @internal */
export function embeddedWidth(text: string, size: number, metrics: PdfEmbeddedMetrics, style: TextStyle = {}): number {
  let units = 0;
  let previous: number | undefined;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    units += metrics.advances.get(code) ?? 0;
    // The pair table is the shaper's own output, so a kerned run measures here exactly as it will
    // be set — which is what keeps a line break where measurement decided it goes.
    if (previous !== undefined) units += metrics.kerning?.get(`${previous},${code}`) ?? 0;
    previous = code;
  }
  return (units * size) / 1000 + (style.tracking ?? 0) * [...text].length;
}

/** The widest of a run's pieces, under whatever width function the face setting it measures by. @internal */
export function widestOf(pieces: readonly string[], widthOf: (piece: string) => number): number {
  return Math.max(...pieces.map(widthOf), 0);
}

/** The pieces a run is broken into at its own line breaks, and at whitespace. @internal */
export const linesOf = (text: string): string[] => text.split("\n");
export const wordsOf = (text: string): string[] => text.split(/\s+/).filter((word) => word !== "");

/** What a run wants if it is never broken: the width of the whole of it, set on one line. @internal */
export function preferredWidth(text: string, size: number, style: TextStyle = {}): number {
  return widestOf(linesOf(text), (line) => textWidth(line, size, style));
}

/** What a run needs at minimum: the width of its widest unbreakable word. @internal */
export function minimumWidth(text: string, size: number, style: TextStyle = {}): number {
  return widestOf(wordsOf(text), (word) => textWidth(word, size, style));
}

/** How far a run of elements reaches down a fresh page, and whether it gets there without a break. @internal */
export function measureRun(
  elements: readonly PdfElement[],
  box: PdfBox,
  top: number,
  bottom: number,
  set?: PdfTypesetting,
): { height: number; fits: boolean } {
  let y = top;
  let broke = false;
  for (const element of elements) {
    for (const fragment of element.fragments(box, set)) {
      if (y + fragment.reserve > bottom) {
        y = top;
        broke = true;
      }
      y += fragment.advance;
    }
  }
  return { height: y - top, fits: !broke };
}
