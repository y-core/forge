import { err } from "../../../result/result";
import { matchFace } from "./match";
import type { PdfFontPack, PdfFontSet } from "./types";

/** Builds the font set a document selects from, resolving a request through the CSS ladder. @public */
export function createPdfFontSet(packs: readonly PdfFontPack[]): PdfFontSet {
  const families = new Map(packs.map((pack) => [pack.family, pack.faces]));
  return {
    families: [...families.keys()],
    match(request) {
      const faces = families.get(request.family);
      if (faces === undefined) {
        return err({ kind: "unknown-family", message: `${request.family} is not in this font set — add a pack for it` });
      }
      return matchFace(faces, request);
    },
  };
}
