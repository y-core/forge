import type { InlineConstruct, InlineMatch } from "./types";

const NUMBER_SIGN = 0x23;
const AMPERSAND = 0x26;
const SLASH = 0x2f;
const UNDERSCORE = 0x5f;
const PUNCTUATION_BEFORE_NO_TAG: ReadonlySet<number> = new Set([NUMBER_SIGN, SLASH, AMPERSAND, UNDERSCORE]);
const TAG_LETTER = /\p{L}/u;
const TAG_BODY = /[\p{L}\p{M}\p{N}_-]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/;
const MAX_TAG_LENGTH = 1024;

// micromark reads a tag one UTF-16 code unit at a time, so an astral letter never matches; the dialect keeps that.
function matchesUnit(pattern: RegExp, code: number): boolean {
  return !Number.isNaN(code) && pattern.test(String.fromCharCode(code));
}

function canPrecedeTag(previous: number): boolean {
  if (previous < 0 || matchesUnit(WHITESPACE, previous)) return true;
  return matchesUnit(PUNCTUATION, previous) && !PUNCTUATION_BEFORE_NO_TAG.has(previous);
}

function scanTag(content: string, at: number, limit: number): InlineMatch | null {
  if (!canPrecedeTag(at > 0 ? content.charCodeAt(at - 1) : -1)) return null;
  let end = at + 1;
  if (end >= limit || !matchesUnit(TAG_LETTER, content.charCodeAt(end))) return null;
  end++;
  while (end < limit) {
    const code = content.charCodeAt(end);
    if (matchesUnit(TAG_BODY, code)) end++;
    else if (code === SLASH && end + 1 < limit && matchesUnit(TAG_BODY, content.charCodeAt(end + 1))) end += 2;
    else break;
  }
  return { end, node: { type: "tag", name: content.slice(at + 1, end), start: at, end } };
}

/** The `#tag` and `#area/sub` construct, kept only outside links and images. */
export const TAG_CONSTRUCT: InlineConstruct = {
  name: "tag",
  triggers: [NUMBER_SIGN],
  maxLength: MAX_TAG_LENGTH,
  scan: scanTag,
  accept: (_node, { inLink, inImage }) => !inLink && !inImage,
};
