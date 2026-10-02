import { MARGIN, PAGE_HEIGHT, PAGE_WIDTH } from "./geometry";
import type { PdfPageSize, PdfPageSpec, PdfResolvedPage } from "./types";

// The ISO A series and the US sizes, in points at 72 per inch. A new size is an entry here, never a
// branch downstream: everything below this file sees points only.
const SIZES: Readonly<Record<PdfPageSize, readonly [number, number]>> = {
  a2: [1191, 1684],
  a3: [842, 1191],
  a4: [PAGE_WIDTH, PAGE_HEIGHT],
  a5: [420, 595],
  a6: [298, 420],
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
};

/** Every page size this engine names, in the order the A series runs. @public */
export const PDF_PAGE_SIZES: readonly PdfPageSize[] = Object.keys(SIZES) as PdfPageSize[];

/** A page spec resolved to points, with each margin settled and orientation applied. @public */
export function resolvePdfPage(spec: PdfPageSpec = {}): PdfResolvedPage {
  const named = spec.size === undefined ? SIZES.a4 : SIZES[spec.size];
  const [portraitWidth, portraitHeight] = spec.points ?? named;
  const landscape = spec.orientation === "landscape";
  const margin = spec.margin ?? {};
  const all = margin.all ?? MARGIN;
  return {
    width: landscape ? portraitHeight : portraitWidth,
    height: landscape ? portraitWidth : portraitHeight,
    margin: { top: margin.top ?? all, right: margin.right ?? all, bottom: margin.bottom ?? all, left: margin.left ?? all },
  };
}

/** The room a page leaves for content, once its margins are taken out. @public */
export function pdfContentBox(page: PdfResolvedPage): { x: number; width: number; top: number; bottom: number } {
  return {
    x: page.margin.left,
    width: page.width - page.margin.left - page.margin.right,
    top: page.margin.top,
    bottom: page.height - page.margin.bottom,
  };
}
