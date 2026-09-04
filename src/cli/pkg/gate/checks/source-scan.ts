import { blankComments } from "./modern-css-parse";

/** The index just past a string opened at `start`, or -1 when it never closes. */
function endOfQuoted(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === quote) return i + 1;
    // A `'` or `"` cannot hold a raw newline, so one that reaches the line end is an apostrophe in
    // prose or JSX text — data, not a string that would swallow the `//` after it.
    if (char === "\n" && quote !== "`") return -1;
  }
  return -1;
}

/** `source` with block and `//` comments blanked space-for-space. @public */
export function blankSourceComments(source: string): string {
  const scanned = blankComments(source);
  // Split by code unit, never by code point: every index in this file is a UTF-16 offset, and an
  // astral character reassembled from a code-point split would move every offset after it.
  const out = scanned.split("");

  for (let i = 0; i < scanned.length; i++) {
    const char = scanned[i];
    if (char === "'" || char === '"' || char === "`") {
      const end = endOfQuoted(scanned, i);
      if (end !== -1) i = end - 1;
      continue;
    }
    if (char !== "/" || scanned[i + 1] !== "/") continue;

    const lineEnd = scanned.indexOf("\n", i);
    const end = lineEnd === -1 ? scanned.length : lineEnd;
    for (let j = i; j < end; j++) out[j] = " ";
    i = end;
  }
  return out.join("");
}

/** The index just past a string or template literal opened at `start`, skipping `${…}` by recursion. */
function endOfString(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === quote) return i + 1;
    if (quote === "`" && char === "$" && source[i + 1] === "{") {
      const close = balancedSpan(source, i + 1);
      if (close === -1) return -1;
      i = close;
    }
  }
  return -1;
}

/** Index of the bracket closing the one at `open`, or -1 when the span is unbalanced. @public */
export function balancedSpan(source: string, open: number): number {
  const opener = source[open];
  if (opener !== "(" && opener !== "{") return -1;
  const closer = opener === "(" ? ")" : "}";

  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i] ?? "";
    // A regex literal is not lexed, so a bracket inside one unbalances the span. That fails to -1,
    // which the callers skip — never to a fabricated literal.
    if (char === "'" || char === '"' || char === "`") {
      const end = endOfString(source, i);
      if (end === -1) return -1;
      i = end - 1;
      continue;
    }
    if (char === opener) depth++;
    else if (char === closer && --depth === 0) return i;
  }
  return -1;
}
