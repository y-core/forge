const TOKEN_SYMBOLS: ReadonlySet<string> = new Set([..."!#$%&'*+-.^_`|~"]);

function isTokenChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return (ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || TOKEN_SYMBOLS.has(ch);
}

function isQuotedTextChar(code: number): boolean {
  return code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

function skipWhitespace(value: string, from: number): number {
  let at = from;
  while (value[at] === " " || value[at] === "\t") at += 1;
  return at;
}

function skipToken(value: string, from: number): number {
  let at = from;
  while (isTokenChar(value[at])) at += 1;
  return at;
}

function skipQuotedString(value: string, from: number): number | null {
  let at = from + 1;
  while (at < value.length) {
    const ch = value[at];
    if (ch === '"') return at + 1;
    if (ch === "\\") {
      if (!isQuotedTextChar(value.charCodeAt(at + 1))) return null;
      at += 2;
    } else {
      if (!isQuotedTextChar(value.charCodeAt(at))) return null;
      at += 1;
    }
  }
  return null;
}

function skipParameterValue(value: string, from: number): number | null {
  const end = value[from] === '"' ? skipQuotedString(value, from) : skipToken(value, from);
  return end === from ? null : end;
}

/** The lowercased `type/subtype` of a Content-Type value, or `null` unless the whole value is one RFC 9110 media type. @internal */
export function mediaTypeEssence(value: string): string | null {
  const start = skipWhitespace(value, 0);
  const slash = skipToken(value, start);
  if (slash === start || value[slash] !== "/") return null;
  const end = skipToken(value, slash + 1);
  if (end === slash + 1) return null;
  let at = skipWhitespace(value, end);
  while (at < value.length) {
    if (value[at] !== ";") return null;
    at = skipWhitespace(value, at + 1);
    const nameEnd = skipToken(value, at);
    if (nameEnd === at) continue;
    if (value[nameEnd] !== "=") return null;
    const valueEnd = skipParameterValue(value, nameEnd + 1);
    if (valueEnd === null) return null;
    at = skipWhitespace(value, valueEnd);
  }
  return value.slice(start, end).toLowerCase();
}

/** Whether a media-type parameter value is a bare RFC 9110 token, needing no quoting. @internal */
export function isMediaTypeToken(value: string): boolean {
  return value !== "" && skipToken(value, 0) === value.length;
}
