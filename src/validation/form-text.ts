import { v } from "./validation";

const CRLF = /\r\n/g;

/** A trimmed string — the default for a single-line text field. @public */
export function formText(): v.GenericSchema<string, string> {
  return v.pipe(v.string(), v.trim());
}

/** A trimmed string whose CRLF line endings are folded to LF — the default for a `<textarea>`. @public */
export function formMultilineText(): v.GenericSchema<string, string> {
  return v.pipe(
    v.string(),
    v.transform((value) => value.replace(CRLF, "\n")),
    v.trim(),
  );
}
