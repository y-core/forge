import { err, ok } from "../../result/result";
import { v } from "../../validation/mod";
import type { Ink, PdfArtwork, PdfResult } from "./types";

const COORDINATE = v.pipe(v.number(), v.finite());

const EXTENT = v.pipe(v.number(), v.finite(), v.gtValue(0));

const CHANNEL = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1));

const INK = v.pipe(
  v.union([v.strictTuple([CHANNEL, CHANNEL, CHANNEL]), v.strictTuple([CHANNEL, CHANNEL, CHANNEL, CHANNEL])]),
  v.transform((ink): Ink => ink),
);

const COMMAND = v.variant("op", [
  v.object({ op: v.literal("move"), x: COORDINATE, y: COORDINATE }),
  v.object({ op: v.literal("line"), x: COORDINATE, y: COORDINATE }),
  v.object({ op: v.literal("curve"), x1: COORDINATE, y1: COORDINATE, x2: COORDINATE, y2: COORDINATE, x: COORDINATE, y: COORDINATE }),
  v.object({ op: v.literal("rect"), x: COORDINATE, y: COORDINATE, width: COORDINATE, height: COORDINATE }),
  v.object({ op: v.literal("close") }),
]);

const PATH = v.object({
  commands: v.pipe(v.array(COMMAND), v.readonly()),
  fill: v.optional(INK),
  stroke: v.optional(INK),
  weight: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
});

/** The shape a mark must have before this engine draws it. @internal */
export const ARTWORK = v.object({ width: EXTENT, height: EXTENT, paths: v.pipe(v.array(PATH), v.readonly()), alt: v.optional(v.string()) });

/** `value` as artwork this engine can draw, or a refusal naming the field of `subject` that is not. @internal */
export function checkArtwork(value: unknown, subject: string): PdfResult<PdfArtwork> {
  const checked = v.safeParse(ARTWORK, value);
  if (checked.success) return ok(checked.output);
  const [issue] = checked.issues;
  // Every key is a schema key or an array index, since v.object strips unknown keys, so no input value reaches the message.
  const field = (issue.path ?? []).map((item) => String(item.key)).join(".");
  const at = field === "" ? "" : ` at ${field}`;
  return err({ kind: "artwork", message: `${subject} is malformed${at}` });
}

/** A parsed mark artifact as artwork this engine can draw, or a refusal naming the field that is not. @public */
export function readPdfArtwork(json: unknown): PdfResult<PdfArtwork> {
  return checkArtwork(json, "the artwork");
}
