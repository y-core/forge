import { err, ok } from "../../../result/result";
import type { PdfFace, PdfFontRequest, PdfFontStretch, PdfFontStyle, PdfFontWeight } from "./types";

const NORMAL_STRETCH = 100;
const REGULAR_WEIGHT = 400;

// CSS Fonts 4 §5.2 orders the axes stretch, then style, then weight — narrowing the candidate set
// one axis at a time, so a later axis never reaches a face an earlier one ruled out.
function byStretch(faces: readonly PdfFace[], wanted: PdfFontStretch): PdfFace[] {
  const exact = faces.filter((face) => face.stretch === wanted);
  if (exact.length > 0) return exact;
  const nearer = (a: PdfFace, b: PdfFace): number => {
    const preferred = (face: PdfFace): number => (wanted <= NORMAL_STRETCH ? (face.stretch <= wanted ? 0 : 1) : face.stretch >= wanted ? 0 : 1);
    return preferred(a) - preferred(b) || Math.abs(a.stretch - wanted) - Math.abs(b.stretch - wanted);
  };
  const sorted = [...faces].sort(nearer);
  const best = sorted[0];
  return best === undefined ? [] : sorted.filter((face) => face.stretch === best.stretch);
}

// A requested italic is matched or refused, never synthesised: shearing a roman produces a face the
// document did not ask for, and in a legal document that is a different typeface, not a near miss.
function byStyle(faces: readonly PdfFace[], wanted: PdfFontStyle): PdfFace[] {
  const order: PdfFontStyle[] = wanted === "italic" ? ["italic", "oblique"] : wanted === "oblique" ? ["oblique", "italic"] : ["normal"];
  for (const style of order) {
    const found = faces.filter((face) => face.style === style);
    if (found.length > 0) return found;
  }
  return [];
}

function byWeight(faces: readonly PdfFace[], wanted: PdfFontWeight): PdfFace | undefined {
  const exact = faces.find((face) => face.weight === wanted);
  if (exact !== undefined) return exact;
  const below = faces.filter((face) => face.weight < wanted).sort((a, b) => b.weight - a.weight);
  const above = faces.filter((face) => face.weight > wanted).sort((a, b) => a.weight - b.weight);
  // Between 400 and 500 a heavier face is tried first, but only as far as 500; outside that range
  // the search runs away from regular in the direction asked for.
  if (wanted >= REGULAR_WEIGHT && wanted <= 500) {
    const mid = above.filter((face) => face.weight <= 500);
    return mid[0] ?? below[0] ?? above[0];
  }
  return wanted < REGULAR_WEIGHT ? (below[0] ?? above[0]) : (above[0] ?? below[0]);
}

/** The face a request resolves to, walking the axes in the order CSS specifies. @internal */
export function matchFace(faces: readonly PdfFace[], request: PdfFontRequest) {
  const stretched = byStretch(faces, request.stretch ?? NORMAL_STRETCH);
  const style = request.style ?? "normal";
  const styled = byStyle(stretched, style);
  if (styled.length === 0) {
    return err({ kind: "no-style" as const, message: `${request.family} ships no ${style} face — embed one, or ask for a style it has` });
  }
  const face = byWeight(styled, request.weight ?? REGULAR_WEIGHT);
  return face === undefined ? err({ kind: "no-style" as const, message: `${request.family} ships no face at all for ${style}` }) : ok(face);
}
