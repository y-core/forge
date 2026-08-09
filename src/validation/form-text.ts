import { v } from "./validation";

/** Every CRLF pair in a submitted value. Global, and `String.prototype.replace` resets `lastIndex`. */
const CRLF = /\r\n/g;

/**
 * A trimmed string — the default for a single-line text field.
 *
 * Normalizing form text is the schema's job, not the reader's, and that is a deliberate split rather
 * than an omission. `formToObject` hands a schema exactly what was submitted, for four reasons:
 *
 * 1. **It does not only see strings.** A `File` passes through unchanged and a repeated key arrives
 *    as an array, so trimming there means two special cases guarding one transformation — and a
 *    reader that has to ask what shape a value is has stopped being a reader.
 * 2. **`"   "` has to stay representable.** A schema may legitimately want to refuse whitespace-only
 *    input, and it cannot once the reader has already collapsed it: by the time the schema runs, an
 *    all-spaces submission and a well-formed one are indistinguishable.
 * 3. **A normalization the schema cannot see is invisible.** The parsed output would then differ from
 *    the declared input for reasons written down nowhere in the schema, which is exactly the defect a
 *    named-field reader had.
 * 4. **Line-ending folding is right for a `<textarea>` and wrong for an `<input>`**, and the reader
 *    cannot tell the two apart — it sees a name and a value, never the control that produced them.
 *    Only the schema knows, which is why that behaviour is `formMultilineText` and not the default.
 *
 * Compose it like any other schema: `v.pipe(formText(), v.minLength(1))` refuses `"   "`, because the
 * trim runs first and the length check then sees the empty string.
 *
 * @example
 * ```typescript
 * const ContactSchema = strictObject({ name: v.pipe(formText(), v.minLength(1)), email: v.pipe(formText(), v.email()) });
 * ```
 * @public
 */
export function formText(): v.GenericSchema<string, string> {
  return v.pipe(v.string(), v.trim());
}

/**
 * A trimmed string whose CRLF line endings are folded to LF — the default for a `<textarea>`.
 *
 * A browser submits a textarea's line breaks as CRLF per the URL-encoded form spec, regardless of
 * what the user typed or what platform they are on. Folding them to LF makes the parsed value depend
 * on the content rather than on the transport, which is what anything downstream — a stored record,
 * an outbound email body, a diff against a previous submission — needs in order to compare equal.
 *
 * See `formText` for why this normalization belongs to the schema and not to `formToObject`; the
 * short version is that only the schema knows a field was a textarea.
 *
 * **What the fold buys is length that means one thing**, and it is the fold's *presence* that buys
 * it, not its position: `v.pipe(formMultilineText(), v.maxLength(500))` counts each line break once,
 * so a 500-character limit means the same whether the newline arrived as LF or CRLF, instead of
 * silently halving the budget for line breaks.
 *
 * **The fold's position relative to the trim is not observable**, and this comment says so because
 * two earlier attempts to justify the ordering were both wrong. `trim` treats `\r` and `\n` alike, so
 * the two orderings agree on output — verified exhaustively over every string of length 0–5 over
 * `{a, space, \r, \n, \t}` — and a caller's own action is appended *after* this whole pipe, so it
 * observes that agreed output and cannot tell the orderings apart either. Fold-first is kept because
 * normalize-then-narrow is the readable order, and for no stronger reason than that.
 *
 * @example
 * ```typescript
 * const MessageSchema = strictObject({ message: v.pipe(formMultilineText(), v.minLength(1), v.maxLength(2000)) });
 * ```
 * @public
 */
export function formMultilineText(): v.GenericSchema<string, string> {
  return v.pipe(
    v.string(),
    v.transform((value) => value.replace(CRLF, "\n")),
    v.trim(),
  );
}
