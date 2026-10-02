const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const TAB = 0x09;
const SPACE = 0x20;

const UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;
const LABEL_WHITESPACE = /[ \t\r\n]+/g;
const LABEL_EDGE_SPACE = /^ | $/g;

/** Returns the offset each line starts at, treating `\n`, `\r\n` and a lone `\r` as line endings. @internal */
export function createLineIndex(source: string): Int32Array {
  let count = 1;
  for (let at = 0; at < source.length; at++) {
    const code = source.charCodeAt(at);
    if (code === LINE_FEED || (code === CARRIAGE_RETURN && source.charCodeAt(at + 1) !== LINE_FEED)) count++;
  }
  const starts = new Int32Array(count);
  let line = 1;
  for (let at = 0; at < source.length; at++) {
    const code = source.charCodeAt(at);
    if (code === LINE_FEED || (code === CARRIAGE_RETURN && source.charCodeAt(at + 1) !== LINE_FEED)) starts[line++] = at + 1;
  }
  return starts;
}

/** Returns the 1-based line an offset falls on. */
export function lineAtOffset(lineStarts: Int32Array, offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((lineStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/** Reports whether a UTF-16 code unit is a space or a tab. @internal */
export function isSpaceOrTab(code: number): boolean {
  return code === SPACE || code === TAB;
}

/** Reports whether a UTF-16 code unit ends a line. @internal */
export function isLineEnding(code: number): boolean {
  return code === LINE_FEED || code === CARRIAGE_RETURN;
}

/** Reports whether a character is one of CommonMark's 32 ASCII punctuation characters. @internal */
export function isAsciiPunctuation(code: number): boolean {
  return (code >= 0x21 && code <= 0x2f) || (code >= 0x3a && code <= 0x40) || (code >= 0x5b && code <= 0x60) || (code >= 0x7b && code <= 0x7e);
}

// micromark classifies with JavaScript's `\s`, which adds U+000B, U+2028, U+2029 and U+FEFF to CommonMark's set; the dialect matches it.
/** Reports whether a code point is whitespace for flanking and autolink purposes: JavaScript's `\s`. @internal */
export function isUnicodeWhitespace(codePoint: number): boolean {
  if (codePoint < 0x80) return codePoint === SPACE || (codePoint >= TAB && codePoint <= CARRIAGE_RETURN);
  return (
    codePoint === 0xa0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000 ||
    codePoint === 0xfeff
  );
}

/** Reports whether a code point is CommonMark Unicode punctuation: a P or S general category character. @internal */
export function isUnicodePunctuation(codePoint: number): boolean {
  if (codePoint < 0x80) return isAsciiPunctuation(codePoint);
  return UNICODE_PUNCTUATION.test(String.fromCodePoint(codePoint));
}

/** Returns the code point ending just before an offset, or a line feed at the start of the source. @internal */
export function codePointBefore(source: string, at: number): number {
  if (at <= 0) return LINE_FEED;
  const low = source.charCodeAt(at - 1);
  if (low >= 0xdc00 && low <= 0xdfff && at >= 2) {
    const high = source.charCodeAt(at - 2);
    if (high >= 0xd800 && high <= 0xdbff) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
  }
  return low;
}

/** Returns the code point starting at an offset, or a line feed past the end of the source. @internal */
export function codePointAt(source: string, at: number): number {
  return at >= source.length ? LINE_FEED : (source.codePointAt(at) ?? LINE_FEED);
}

/** Normalises a link label for matching: Unicode case fold, then trimmed and with internal whitespace runs collapsed to one space. @internal */
export function normalizeLabel(label: string): string {
  return label.replace(LABEL_WHITESPACE, " ").replace(LABEL_EDGE_SPACE, "").toLowerCase().toUpperCase();
}
