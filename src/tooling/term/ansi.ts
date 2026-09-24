// Pattern adapted from @visulima/string (MIT, Copyright (c) visulima)
// https://github.com/visulima/visulima — packages/data-manipulation/string/src/constants.ts

/** `ESC` — the byte every escape sequence forge emits opens with. @public */
export const ESC = "\u001B";

/** The single-byte `CSI`, an alternative opener some terminals still emit. @public */
export const CSI = "\u009B";

/** One escape sequence as a pattern string: a CSI/SGR sequence, or an OSC 8 introducer terminated by `BEL` or `ESC \`. @internal */
export const ANSI_PATTERN =
  "[\\u001B\\u009B](?:[[()#;?]{0,10}(?:\\d{1,4}(?:;\\d{0,4})*)?[0-9A-ORZcf-nqry=><]|\\]8;;[^\\u0007\\u001B]{0,100}(?:\\u0007|\\u001B\\\\))";

/** An SGR sequence alone — the subset that changes how following text is drawn — with its parameters captured. @internal */
export const SGR_PATTERN = "\\u001B\\[([0-9;]*)m";

/** The compiled pattern, carrying `g` so `stripAnsi` replaces every occurrence — replace with it, never scan. @public */
export const RE_ANSI: RegExp = new RegExp(ANSI_PATTERN, "g");

/** The SGR sequence that closes every open style. @internal */
export const RESET = `${ESC}[0m`;

/** Whether the string contains anything the width scanner would have to skip. @public */
export function hasAnsi(input: string): boolean {
  return input.includes(ESC) || input.includes(CSI);
}

/** Removes every escape sequence, leaving the text a terminal would actually show. @public */
export function stripAnsi(input: string): string {
  return hasAnsi(input) ? input.replace(RE_ANSI, "") : input;
}
