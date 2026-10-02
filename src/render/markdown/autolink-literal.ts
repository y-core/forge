import { isUnicodePunctuation, isUnicodeWhitespace } from "./source";
import type { LiteralAutolink } from "./types";

const BANG = 0x21;
const DOUBLE_QUOTE = 0x22;
const AMPERSAND = 0x26;
const SINGLE_QUOTE = 0x27;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const ASTERISK = 0x2a;
const PLUS = 0x2b;
const COMMA = 0x2c;
const HYPHEN = 0x2d;
const PERIOD = 0x2e;
const SLASH = 0x2f;
const COLON = 0x3a;
const SEMICOLON = 0x3b;
const OPEN_ANGLE = 0x3c;
const QUESTION = 0x3f;
const AT = 0x40;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const UNDERSCORE = 0x5f;
const TILDE = 0x7e;
const LOWER_W = 0x77;
const UPPER_W = 0x57;
const LOWER_H = 0x68;
const UPPER_H = 0x48;
const MAX_PROTOCOL = 5;

function isAsciiAlpha(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isAsciiAlphanumeric(code: number): boolean {
  return isAsciiAlpha(code) || (code >= 0x30 && code <= 0x39);
}

function isAtext(code: number): boolean {
  return code === PLUS || code === HYPHEN || code === PERIOD || code === UNDERSCORE || isAsciiAlphanumeric(code);
}

function isTrailChar(code: number): boolean {
  return (
    code === BANG ||
    code === DOUBLE_QUOTE ||
    code === SINGLE_QUOTE ||
    code === CLOSE_PAREN ||
    code === ASTERISK ||
    code === COMMA ||
    code === PERIOD ||
    code === COLON ||
    code === SEMICOLON ||
    code === QUESTION ||
    code === UNDERSCORE ||
    code === TILDE
  );
}

function isPathPunctuation(code: number): boolean {
  return isTrailChar(code) || code === AMPERSAND || code === OPEN_ANGLE || code === CLOSE_BRACKET;
}

function isSpace(content: string, at: number): boolean {
  return at >= content.length || isUnicodeWhitespace(content.charCodeAt(at));
}

function codeLength(content: string, at: number): number {
  const code = content.charCodeAt(at);
  return code >= 0xd800 && code <= 0xdbff && at + 1 < content.length ? 2 : 1;
}

/** Recognises GFM literal autolinks with micromark's rules, remembering failed trail checks so no run of punctuation is rescanned. @internal */
export function createAutolinkLiteralScanner(content: string) {
  const length = content.length;
  let trailFailFrom = -1;
  let trailFailTo = -1;

  function trailFrom(start: number): boolean {
    if (start > trailFailFrom && start <= trailFailTo) return false;
    let at = start;
    let afterBracket = false;
    while (true) {
      const code = at < length ? content.charCodeAt(at) : -1;
      if (afterBracket) {
        afterBracket = false;
        if (code === -1 || code === OPEN_PAREN || code === OPEN_BRACKET || isSpace(content, at)) return true;
      }
      if (code !== -1 && isTrailChar(code)) at++;
      else if (code === AMPERSAND) {
        at++;
        if (!isAsciiAlpha(content.charCodeAt(at))) return fail(start, at);
        while (isAsciiAlpha(content.charCodeAt(at))) at++;
        if (content.charCodeAt(at) !== SEMICOLON) return fail(start, at);
        at++;
      } else if (code === CLOSE_BRACKET) {
        at++;
        afterBracket = true;
      } else if (code === OPEN_ANGLE || code === -1 || isSpace(content, at)) return true;
      else return fail(start, at);
    }
  }

  function fail(start: number, stop: number): false {
    trailFailFrom = start;
    trailFailTo = Math.max(trailFailTo, stop);
    return false;
  }

  let memoFrom = -1;
  let memoReuseBefore = -1;
  let memoEnd = -1;

  // A later start before the last scan's last-but-one label stops where it did and sees the same last two labels, so it shares the answer.
  function domain(start: number): number {
    if (start > memoFrom && start < memoReuseBefore) return memoEnd;
    memoFrom = start;
    memoEnd = scanDomain(start);
    return memoEnd;
  }

  function scanDomain(start: number): number {
    let at = start;
    let labelStart = start;
    let lastButOneStart = start;
    let underscoreInLast = false;
    let underscoreInLastButOne = false;
    let seen = false;
    while (at < length) {
      const code = content.charCodeAt(at);
      if (code === PERIOD || code === UNDERSCORE) {
        if (trailFrom(at)) break;
        if (code === UNDERSCORE) underscoreInLast = true;
        else {
          underscoreInLastButOne = underscoreInLast;
          underscoreInLast = false;
          lastButOneStart = labelStart;
          labelStart = at + 1;
        }
        at++;
        continue;
      }
      const point = content.charCodeAt(at);
      if (isUnicodeWhitespace(point) || (code !== HYPHEN && isUnicodePunctuation(point))) break;
      seen = true;
      at += codeLength(content, at);
    }
    memoReuseBefore = lastButOneStart;
    return underscoreInLast || underscoreInLastButOne || !seen ? -1 : at;
  }

  function path(start: number): number {
    let at = start;
    let open = 0;
    let close = 0;
    while (at < length) {
      const code = content.charCodeAt(at);
      if (code === OPEN_PAREN) {
        open++;
        at++;
      } else if (code === CLOSE_PAREN && close < open) {
        close++;
        at++;
      } else if (isPathPunctuation(code)) {
        if (trailFrom(at)) return at;
        if (code === CLOSE_PAREN) close++;
        at++;
      } else if (isSpace(content, at)) return at;
      else at += codeLength(content, at);
    }
    return at;
  }

  function www(start: number): LiteralAutolink | null {
    for (let index = 0; index < 3; index++) {
      const code = content.charCodeAt(start + index);
      if (code !== LOWER_W && code !== UPPER_W) return null;
    }
    if (content.charCodeAt(start + 3) !== PERIOD || start + 4 >= length) return null;
    const domainEnd = domain(start);
    if (domainEnd < 0) return null;
    const end = path(domainEnd);
    return { end, url: "http://" + content.slice(start, end) };
  }

  function protocol(start: number): LiteralAutolink | null {
    let at = start;
    while (at < length && at - start < MAX_PROTOCOL && isAsciiAlpha(content.charCodeAt(at))) at++;
    const name = content.slice(start, at).toLowerCase();
    if ((name !== "http" && name !== "https") || content.charCodeAt(at) !== COLON) return null;
    if (content.charCodeAt(at + 1) !== SLASH || content.charCodeAt(at + 2) !== SLASH) return null;
    at += 3;
    const point = content.charCodeAt(at);
    if (at >= length || point < 0x20 || point === 0x7f || isUnicodeWhitespace(point) || isUnicodePunctuation(point)) return null;
    const domainEnd = domain(at);
    if (domainEnd < 0) return null;
    const end = path(domainEnd);
    return { end, url: content.slice(start, end) };
  }

  function email(start: number): LiteralAutolink | null {
    let at = start;
    while (isAtext(content.charCodeAt(at))) at++;
    if (content.charCodeAt(at) !== AT) return null;
    at++;
    let data = false;
    let dot = false;
    while (at < length) {
      const code = content.charCodeAt(at);
      if (code === PERIOD) {
        if (!isAsciiAlphanumeric(content.charCodeAt(at + 1))) break;
        dot = true;
        at++;
      } else if (code === HYPHEN || code === UNDERSCORE || isAsciiAlphanumeric(code)) {
        data = true;
        at++;
      } else break;
    }
    if (!data || !dot || !isAsciiAlpha(content.charCodeAt(at - 1))) return null;
    return { end: at, url: "mailto:" + content.slice(start, at) };
  }

  /** Tries every literal that may start at `at`, given the character before it, in micromark's order. */
  function scan(at: number): LiteralAutolink | null {
    const code = content.charCodeAt(at);
    const previous = at === 0 ? -1 : content.charCodeAt(at - 1);
    if (isAtext(code) && previous !== SLASH && !isAtext(previous)) {
      const found = email(at);
      if (found !== null) return found;
    }
    if ((code === LOWER_W || code === UPPER_W) && isWwwBoundary(content, at)) return www(at);
    if ((code === LOWER_H || code === UPPER_H) && !isAsciiAlpha(previous)) return protocol(at);
    return null;
  }

  return { scan };
}

function isWwwBoundary(content: string, at: number): boolean {
  if (at === 0) return true;
  const previous = content.charCodeAt(at - 1);
  return (
    previous === OPEN_PAREN ||
    previous === ASTERISK ||
    previous === UNDERSCORE ||
    previous === OPEN_BRACKET ||
    previous === CLOSE_BRACKET ||
    previous === TILDE ||
    previous === 0x20 ||
    previous === 0x09 ||
    previous === 0x0a ||
    previous === 0x0d
  );
}

/** Reports whether a literal autolink could start at `at`, so a text run stops there to try one. @internal */
export function mayStartAutolinkLiteral(content: string, at: number): boolean {
  const code = content.charCodeAt(at);
  const previous = at === 0 ? -1 : content.charCodeAt(at - 1);
  if (isAtext(code) && previous !== SLASH && !isAtext(previous)) return true;
  if ((code === LOWER_W || code === UPPER_W) && isWwwBoundary(content, at)) return true;
  return (code === LOWER_H || code === UPPER_H) && !isAsciiAlpha(previous);
}
