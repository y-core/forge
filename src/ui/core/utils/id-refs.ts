// HTML's ASCII whitespace set, deliberately not JS `\s`: U+00A0 and the Unicode spaces are legal id
// characters that no parser treats as a token separator.
/** ASCII whitespace, which separates the ids in an IDREF list. @internal */
export const IDREF_SEPARATOR: RegExp = /[\t\n\f\r ]/;

/** One IDREF list, the existing ids first and each id once, `undefined` when none remain. @internal */
export function mergeIdRefs(existing: string | undefined, added: readonly (string | undefined)[]): string | undefined {
  const ids = new Set([existing, ...added].flatMap((part) => (part === undefined ? [] : part.split(IDREF_SEPARATOR))).filter((id) => id !== ""));
  return ids.size > 0 ? [...ids].join(" ") : undefined;
}
