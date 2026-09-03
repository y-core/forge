/** Resumable-scope name the formatted `Input` stamps and the client scope registers. @public */
export const INPUT_FORMAT_SCOPE = "input-format";

/** Attribute carrying the format template, whose `#` are the slots and whose other characters are literals. @public */
export const INPUT_FORMAT_ATTR = "data-format";

const SLOT = "#";
const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);

/** The template's literal alphabet — every non-slot character it uses, plus whitespace unconditionally. */
function literalsOf(template: string): Set<string> {
  const literals = new Set(WHITESPACE);
  for (const char of template) if (char !== SLOT) literals.add(char);
  return literals;
}

/** `value` with every character the template treats as a literal removed — what makes formatting idempotent. @public */
export function stripFormat(template: string, value: string): string {
  const literals = literalsOf(template);
  let significant = "";
  for (const char of value) if (!literals.has(char)) significant += char;
  return significant;
}

/** `value` regrouped onto the template, or its bare significant characters when it does not fit. @public */
export function applyFormat(template: string, value: string): string {
  const slots = [...template].filter((char) => char === SLOT).length;
  if (slots === 0) return value;

  const significant = stripFormat(template, value);
  if (significant.length === 0) return "";
  if (significant.length > slots) return significant;

  let formatted = "";
  let filled = 0;
  for (const char of template) {
    if (char === SLOT) {
      if (filled === significant.length) break;
      formatted += significant[filled];
      filled += 1;
      continue;
    }
    // A literal is only earned once a further slot will still be filled, so a partial value grows no trailing separator.
    if (filled < significant.length) formatted += char;
  }
  return formatted;
}
