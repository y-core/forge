import { v } from "./validation";

const NON_DIGITS = /\D/g;

/** A string reduced to its ASCII digits — the shape for a control whose separators are cosmetic. @public */
export function formDigits(): v.GenericSchema<string, string> {
  return v.pipe(
    v.string(),
    v.transform((value) => value.replace(NON_DIGITS, "")),
  );
}
