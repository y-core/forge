import { isAsciiPunctuation, isSpaceOrTab, normalizeLabel } from "./source";
import type { DefinitionScan, DestinationScan } from "./types";
import { unescapeSpan } from "./unescape";

const BACKSLASH = 0x5c;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const OPEN_ANGLE = 0x3c;
const CLOSE_ANGLE = 0x3e;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;
const COLON = 0x3a;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** The longest link label the spec allows between its brackets. @internal */
export const MAX_LABEL_LENGTH = 999;

/** The deepest nesting of unescaped parentheses a bare link destination may hold. @internal */
export const MAX_DESTINATION_PARENS = 32;

/** Scans a `[label]` from its opening bracket, returning the offset past `]`, or -1 when no label of at most 999 characters closes there. @internal */
export function scanLinkLabel(source: string, at: number, limit: number): number {
  const contentLimit = Math.min(limit, at + 1 + MAX_LABEL_LENGTH + 1);
  for (let cursor = at + 1; cursor < contentLimit; cursor++) {
    const code = source.charCodeAt(cursor);
    if (code === BACKSLASH && cursor + 1 < limit) cursor++;
    else if (code === OPEN_BRACKET) return -1;
    else if (code === CLOSE_BRACKET) return cursor - (at + 1) <= MAX_LABEL_LENGTH ? cursor + 1 : -1;
  }
  return -1;
}

/** Scans a link destination, `<…>` or bare with balanced parentheses, returning null when none starts at `at`; a bare one may be empty. @internal */
export function scanLinkDestination(source: string, at: number, limit: number): DestinationScan | null {
  if (source.charCodeAt(at) === OPEN_ANGLE) {
    for (let cursor = at + 1; cursor < limit; cursor++) {
      const code = source.charCodeAt(cursor);
      if (code === BACKSLASH && cursor + 1 < limit && isAsciiPunctuation(source.charCodeAt(cursor + 1))) cursor++;
      else if (code === CLOSE_ANGLE) return { end: cursor + 1, textStart: at + 1, textEnd: cursor };
      else if (code === OPEN_ANGLE || code === LINE_FEED || code === CARRIAGE_RETURN) return null;
    }
    return null;
  }
  let depth = 0;
  let cursor = at;
  for (; cursor < limit; cursor++) {
    const code = source.charCodeAt(cursor);
    if (code === BACKSLASH && cursor + 1 < limit && source.charCodeAt(cursor + 1) > 0x20 && source.charCodeAt(cursor + 1) !== 0x7f) cursor++;
    else if (code === OPEN_PAREN) {
      if (++depth > MAX_DESTINATION_PARENS) return null;
    } else if (code === CLOSE_PAREN) {
      if (depth === 0) break;
      depth--;
    } else if (code <= 0x20 || code === 0x7f) break;
  }
  return depth === 0 ? { end: cursor, textStart: at, textEnd: cursor } : null;
}

/** Scans a `"…"`, `'…'` or `(…)` link title from its opening delimiter, returning the offset past its close, or -1. @internal */
export function scanLinkTitle(source: string, at: number, limit: number): number {
  const open = source.charCodeAt(at);
  const close = open === OPEN_PAREN ? CLOSE_PAREN : open;
  if (open !== DOUBLE_QUOTE && open !== SINGLE_QUOTE && open !== OPEN_PAREN) return -1;
  for (let cursor = at + 1; cursor < limit; cursor++) {
    const code = source.charCodeAt(cursor);
    if (code === BACKSLASH && cursor + 1 < limit) cursor++;
    else if (code === close) return cursor + 1;
    else if (open === OPEN_PAREN && code === OPEN_PAREN) return -1;
  }
  return -1;
}

/** Skips spaces and tabs with at most one line ending among them. @internal */
export function skipSpaceAndNewline(source: string, at: number, limit: number): number {
  let cursor = at;
  while (cursor < limit && isSpaceOrTab(source.charCodeAt(cursor))) cursor++;
  if (source.charCodeAt(cursor) === CARRIAGE_RETURN && cursor < limit) cursor++;
  if (source.charCodeAt(cursor) === LINE_FEED && cursor < limit) cursor++;
  while (cursor < limit && isSpaceOrTab(source.charCodeAt(cursor))) cursor++;
  return cursor;
}

function skipToLineEnd(source: string, at: number, limit: number): number {
  let cursor = at;
  while (cursor < limit && isSpaceOrTab(source.charCodeAt(cursor))) cursor++;
  if (cursor >= limit) return limit;
  return source.charCodeAt(cursor) === LINE_FEED ? cursor + 1 : -1;
}

/** Reads one link reference definition from the start of `\n`-joined paragraph content, or returns null when none starts there. @internal */
export function scanDefinition(content: string, at: number): DefinitionScan | null {
  const limit = content.length;
  const labelEnd = scanLinkLabel(content, at, limit);
  if (labelEnd < 0 || content.charCodeAt(labelEnd) !== COLON) return null;
  const label = normalizeLabel(content.slice(at + 1, labelEnd - 1));
  if (label === "") return null;

  const destination = scanLinkDestination(content, skipSpaceAndNewline(content, labelEnd + 1, limit), limit);
  if (destination === null) return null;
  if (destination.end === destination.textEnd && destination.textStart === destination.textEnd) return null;
  const url = unescapeSpan(content, destination.textStart, destination.textEnd);

  const beforeTitle = destination.end;
  const titleStart = skipSpaceAndNewline(content, beforeTitle, limit);
  if (titleStart !== beforeTitle) {
    const titleEnd = scanLinkTitle(content, titleStart, limit);
    if (titleEnd >= 0) {
      const end = skipToLineEnd(content, titleEnd, limit);
      if (end >= 0) return { end, label, url, title: unescapeSpan(content, titleStart + 1, titleEnd - 1) };
    }
  }
  const end = skipToLineEnd(content, beforeTitle, limit);
  return end < 0 ? null : { end, label, url, title: null };
}
