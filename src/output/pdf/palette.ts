import { err, ok } from "../../result/result";
import type { Ink, PdfInkName, PdfPalette, PdfResult } from "./types";

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

// A `Record` keyed on the union rather than a list beside it: adding an ink to `PdfInkName` fails to
// compile here until it is named, so the two cannot drift into disagreeing about what is paintable.
const READ: Record<PdfInkName, true> = { heading: true, rule: true, letterhead: true, intro: true };

/** Every ink name a palette may carry, in the order a refusal lists them. @public */
export const PDF_INK_NAMES: readonly PdfInkName[] = Object.keys(READ) as PdfInkName[];

// A `Set` rather than `in` on the record: `in` walks the prototype chain, so a JSON key named
// `toString` would test as a known ink and land in the silence this guard exists to close.
const PAINTED: ReadonlySet<string> = new Set(PDF_INK_NAMES);

/** Builds a document's colour scheme from `#rrggbb` or `#rrggbbaa` notations, refusing every other one. @public */
export function createPdfPalette(colours: Readonly<Partial<Record<PdfInkName, string>>>): PdfResult<PdfPalette> {
  // The type stops this for a caller who compiles against it; a palette arriving as JSON does not,
  // and an unread name is otherwise a colour that is stored, never consulted and never reported.
  const unread = Object.keys(colours).filter((name) => !PAINTED.has(name));
  if (unread.length > 0) {
    return err({
      kind: "colour-name",
      message: `createPdfPalette: ${unread.join(", ")} name no ink the engine paints with — expected ${PDF_INK_NAMES.join(", ")}`,
    });
  }
  const inks = new Map<string, Ink>();
  for (const [name, notation] of Object.entries(colours) as [PdfInkName, string][]) {
    const parsed = parse(name, notation);
    if (!parsed.ok) return parsed;
    inks.set(name, parsed.data);
  }
  return ok({ ink: (name) => inks.get(name) });
}
