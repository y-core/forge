/** Resumable-scope name the formatted `Input` stamps and the client scope registers. @public */
export const INPUT_FORMAT_SCOPE = "input-format";

/** Attribute carrying the format template, whose `#` are the slots and whose other characters are literals. @public */
export const INPUT_FORMAT_ATTR = "data-format";

const SLOT = "#";
const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);
const CONTENT = /^[\p{L}\p{N}]$/u;

/** `value` with whitespace and the template's separators removed anywhere, and a letter or digit literal only where the template places it. @public */
export function stripFormat(template: string, value: string): string {
  const templateChars = [...template];
  const separators = new Set(templateChars.filter((char) => char !== SLOT && !CONTENT.test(char)));
  let cursor = 0;
  let significant = "";
  for (const char of value) {
    let at = cursor;
    while (at < templateChars.length && templateChars[at] !== SLOT && templateChars[at] !== char) at += 1;
    if (at < templateChars.length && templateChars[at] !== SLOT && templateChars[at] === char) {
      cursor = at + 1;
      continue;
    }
    if (WHITESPACE.has(char) || separators.has(char)) continue;
    cursor = at < templateChars.length ? at + 1 : templateChars.length;
    significant += char;
  }
  return significant;
}

/** `value` regrouped onto the template, or unchanged when its significant characters outnumber the slots. @public */
export function applyFormat(template: string, value: string): string {
  const slots = [...template].filter((char) => char === SLOT).length;
  if (slots === 0) return value;

  // Code points throughout, matching `stripFormat`: measuring or indexing the same string by UTF-16
  // code unit counts an astral character twice and hands back half a surrogate pair.
  const significant = [...stripFormat(template, value)];
  if (significant.length === 0) return "";
  if (significant.length > slots) return value;

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
