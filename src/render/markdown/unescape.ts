import { decodeEntity } from "./entities";
import { isAsciiPunctuation } from "./source";
import type { CharacterReference } from "./types";

const BACKSLASH = 0x5c;
const AMPERSAND = 0x26;
const SEMICOLON = 0x3b;
const NUMBER_SIGN = 0x23;
const REPLACEMENT = "\u{fffd}";
const MAX_ENTITY_NAME = 32;

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isDecimalDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isHexDigit(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

function isReplacedCodePoint(value: number): boolean {
  return (
    value < 0x09 ||
    value === 0x0b ||
    (value > 0x0d && value < 0x20) ||
    (value > 0x7e && value < 0xa0) ||
    (value >= 0xd800 && value <= 0xdfff) ||
    (value >= 0xfdd0 && value <= 0xfdef) ||
    (value & 0xfffe) === 0xfffe ||
    value > 0x10ffff
  );
}

// micromark replaces controls and noncharacters as well as what CommonMark names, and the engine renders as micromark did.
function fromNumericReference(value: number): string {
  return isReplacedCodePoint(value) ? REPLACEMENT : String.fromCodePoint(value);
}

/** Reads an entity or numeric character reference starting at `&`, or returns null when the text there is not a valid one. @internal */
export function readCharacterReference(source: string, at: number, limit: number): CharacterReference | null {
  let cursor = at + 1;
  if (source.charCodeAt(cursor) === NUMBER_SIGN) {
    cursor++;
    const hex = (source.charCodeAt(cursor) | 0x20) === 0x78;
    if (hex) cursor++;
    const digitsStart = cursor;
    const maxDigits = hex ? 6 : 7;
    while (cursor < limit && cursor - digitsStart < maxDigits && (hex ? isHexDigit : isDecimalDigit)(source.charCodeAt(cursor))) cursor++;
    if (cursor === digitsStart || cursor >= limit || source.charCodeAt(cursor) !== SEMICOLON) return null;
    const value = Number.parseInt(source.slice(digitsStart, cursor), hex ? 16 : 10);
    return { text: fromNumericReference(value), end: cursor + 1 };
  }
  const nameStart = cursor;
  while (cursor < limit && cursor - nameStart <= MAX_ENTITY_NAME && isAsciiAlphanumeric(source.charCodeAt(cursor))) cursor++;
  if (cursor === nameStart || cursor >= limit || source.charCodeAt(cursor) !== SEMICOLON) return null;
  const text = decodeEntity(source.slice(nameStart, cursor));
  return text === undefined ? null : { text, end: cursor + 1 };
}

/** Resolves backslash escapes and character references in a span of source, and replaces NUL with U+FFFD. @internal */
export function unescapeSpan(source: string, start: number, end: number): string {
  let out = "";
  let flushed = start;
  for (let at = start; at < end; at++) {
    const code = source.charCodeAt(at);
    if (code === BACKSLASH && at + 1 < end && isAsciiPunctuation(source.charCodeAt(at + 1))) {
      out += source.slice(flushed, at);
      flushed = at + 1;
      at++;
    } else if (code === AMPERSAND) {
      const reference = readCharacterReference(source, at, end);
      if (reference === null) continue;
      out += source.slice(flushed, at) + reference.text;
      flushed = reference.end;
      at = reference.end - 1;
    } else if (code === 0) {
      out += source.slice(flushed, at) + REPLACEMENT;
      flushed = at + 1;
    }
  }
  return flushed === start ? source.slice(start, end) : out + source.slice(flushed, end);
}
