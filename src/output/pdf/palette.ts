import { err, ok } from "../../result/result";
import type { Ink, PdfPalette, PdfResult } from "./types";

const HEX = /^#([\da-f]{6})([\da-f]{2})?$/i;
const OPAQUE = 0xff;

function parse(name: string, notation: string): PdfResult<Ink> {
  const found = HEX.exec(notation);
  if (found === null) {
    return err({ kind: "colour-notation", message: `${name}: expected #rrggbb or #rrggbbaa, got ${notation}` });
  }
  const digits = found[1] ?? "";
  const byte = (at: number): number => Number.parseInt(digits.slice(at, at + 2), 16) / 255;
  const alpha = found[2] === undefined ? OPAQUE : Number.parseInt(found[2], 16);
  // An opaque colour carries no alpha at all rather than one: the fourth component is what makes the
  // writer emit a graphics state, and a document of solid inks should emit none.
  if (alpha === OPAQUE) return ok([byte(0), byte(2), byte(4)]);
  return ok([byte(0), byte(2), byte(4), alpha / 255]);
}

/** Builds a document's colour scheme from `#rrggbb` or `#rrggbbaa` notations, refusing every other one. @public */
export function createPdfPalette(colours: Readonly<Record<string, string>>): PdfResult<PdfPalette> {
  const inks = new Map<string, Ink>();
  for (const [name, notation] of Object.entries(colours)) {
    const parsed = parse(name, notation);
    if (!parsed.ok) return parsed;
    inks.set(name, parsed.data);
  }
  return ok({ ink: (name) => inks.get(name) });
}
