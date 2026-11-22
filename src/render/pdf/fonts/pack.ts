import { err, ok } from "../../../result/result";
import { v } from "../../../validation/mod";
import type { PdfResult } from "../types";
import type { PdfFontMetrics, PdfFontPack, PdfFontPackData } from "./types";

const FINITE = v.pipe(v.number(), v.finite());

const POSITIVE = v.pipe(v.number(), v.finite(), v.gtValue(0));

const CANONICAL_DECIMAL = /^(?:0|[1-9]\d*)$/;

const MAX_CODE_POINT = 0x10ffff;

function isCodePointKey(key: string): boolean {
  return CANONICAL_DECIMAL.test(key) && Number(key) <= MAX_CODE_POINT;
}

const CODE_POINT = v.pipe(v.string(), v.check(isCodePointKey));

const CODE_POINT_PAIR = v.pipe(
  v.string(),
  v.check((key) => {
    const codes = key.split(",");
    return codes.length === 2 && codes.every(isCodePointKey);
  }),
);

const RECORDS = new Set(["advances", "glyphs", "kerning"]);

const METRICS = v.object({
  unitsPerEm: POSITIVE,
  ascent: FINITE,
  descent: FINITE,
  bbox: v.strictTuple([FINITE, FINITE, FINITE, FINITE]),
  advances: v.record(CODE_POINT, FINITE),
  glyphs: v.record(CODE_POINT, FINITE),
  kerning: v.record(CODE_POINT_PAIR, FINITE),
});

const FACE = v.object({
  postScriptName: v.string(),
  weight: FINITE,
  style: v.picklist(["normal", "italic", "oblique"]),
  stretch: FINITE,
  sfnt: v.string(),
  metrics: METRICS,
});

const PACK = v.object({ family: v.string(), faces: v.array(FACE) });

/** `value` as a pack this engine can read, or a refusal naming the field that is not. @internal */
export function checkPdfFontPack(value: unknown): PdfResult<PdfFontPackData> {
  const checked = v.safeParse(PACK, value);
  if (checked.success) return ok(checked.output);
  const [issue] = checked.issues;
  const field: string[] = [];
  // A record's keys are the input's own, so the path stops at the record and no input key reaches the message.
  for (const item of issue.path ?? []) {
    const key = String(item.key);
    field.push(key);
    if (RECORDS.has(key)) break;
  }
  const at = field.length === 0 ? "" : ` at ${field.join(".")}`;
  return err({ kind: "font-pack", message: `the font pack is malformed${at}` });
}

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
/** A parsed pack as the faces a font set matches against, or a refusal naming the malformed field; call it once per load, at module scope. @public */
export function readPdfFontPack(data: unknown, sfnt: (path: string) => Uint8Array | undefined): PdfResult<PdfFontPack> {
  const checked = checkPdfFontPack(data);
  if (!checked.ok) return checked;
  const pack = checked.data;
  return ok({
    family: pack.family,
    faces: pack.faces.map((face) => {
      const bytes = sfnt(face.sfnt);
      return {
        family: pack.family,
        postScriptName: face.postScriptName,
        weight: face.weight,
        style: face.style,
        stretch: face.stretch,
        metrics: readPdfFontMetrics(face.metrics),
        ...(bytes === undefined ? {} : { sfnt: bytes }),
      };
    }),
  });
}
