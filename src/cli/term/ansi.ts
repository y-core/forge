// Pattern adapted from @visulima/string (MIT, Copyright (c) visulima)
// https://github.com/visulima/visulima — packages/data-manipulation/string/src/constants.ts

/** `ESC` — the byte every escape sequence forge emits opens with. @public */
export const ESC = "\u001B";

/** The single-byte `CSI`, an alternative opener some terminals still emit. @public */
export const CSI = "\u009B";

/**
 * One escape sequence, as a pattern string: a CSI/SGR-style sequence, or a complete OSC 8
 * hyperlink introducer terminated by `BEL` or `ESC \`.
 *
 * Held as a string and compiled, rather than written as a literal, because a literal puts raw
 * control characters in the source where they are invisible to anyone reading it.
 * @internal
 */
export const ANSI_PATTERN =
  "[\\u001B\\u009B](?:[[()#;?]{0,10}(?:\\d{1,4}(?:;\\d{0,4})*)?[0-9A-ORZcf-nqry=><]|\\]8;;[^\\u0007\\u001B]{0,100}(?:\\u0007|\\u001B\\\\))";

/**
 * An SGR sequence alone — the subset that changes how the following text is drawn, with its
 * numeric parameters captured.
 *
 * Held as a string for the same reason as `ANSI_PATTERN`: a literal would put raw control
 * characters in the source, where nobody reading it can see them.
 * @internal
 */
export const SGR_PATTERN = "\\u001B\\[([0-9;]*)m";

/**
 * The compiled pattern, carrying `g` so `stripAnsi` replaces every occurrence.
 *
 * Never scan with it. A `g`-flagged `.test()` with a manually assigned `lastIndex` searches
 * *from* that offset rather than anchoring *at* it, so a match found later would be consumed
 * together with all the visible text in between — a documented bug in the reference this is taken
 * from. `width.ts` compiles its own `"y"`-flagged clone of `ANSI_PATTERN` for that reason. @public
 */
export const RE_ANSI: RegExp = new RegExp(ANSI_PATTERN, "g");

/** Whether the string contains anything the width scanner would have to skip. @public */
export function hasAnsi(input: string): boolean {
  return input.includes(ESC) || input.includes(CSI);
}

/** Removes every escape sequence, leaving the text a terminal would actually show. @public */
export function stripAnsi(input: string): string {
  return hasAnsi(input) ? input.replace(RE_ANSI, "") : input;
}
