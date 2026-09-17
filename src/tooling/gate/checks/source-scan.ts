import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, posix, relative, resolve, sep } from "node:path";

import type { CommentSpan } from "./types";

/** Every file under `dir` matching `accept`, repo-relative to `root`, posix-separated and sorted. @public */
export function collectFiles(root: string, dir: string, accept: (name: string) => boolean): string[] {
  const base = resolve(root, dir);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && accept(entry.name)) out.push(relative(root, full).split(sep).join(posix.sep));
    }
  };
  walk(base);
  return out.sort();
}

/** The immediate file names under `base` matching `accept`, sorted. `base` is absolute. @public */
export function listFiles(base: string, accept: (name: string) => boolean): string[] {
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isFile() && accept(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** The immediate subdirectory names of `base`, sorted. `base` is absolute. @public */
export function listDirectories(base: string): string[] {
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The same, for a source that may name either a directory or a single file. @public */
export function collectSource(root: string, source: string, accept: (name: string) => boolean): string[] {
  const base = resolve(root, source);
  if (!existsSync(base)) return [];
  if (statSync(base).isFile()) {
    return accept(basename(base)) ? [relative(root, base).split(sep).join(posix.sep)] : [];
  }
  return collectFiles(root, source, accept);
}

/** Whether `file` is `prefix` or sits beneath it. @public */
export function excludedBy(file: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
}

/** Every file under `sources`, honouring `!`-prefixed exclusions — deduped and sorted. Walks, judges nothing. @public */
export function resolveSources(root: string, sources: readonly string[], accept: (name: string) => boolean): string[] {
  const excluded = sources.filter((source) => source.startsWith("!")).map((source) => source.slice(1));
  const collected = sources.filter((source) => !source.startsWith("!")).flatMap((source) => collectSource(root, source, accept));
  return [...new Set(collected)].filter((file) => !excludedBy(file, excluded)).sort();
}

/** The 1-indexed line `index` falls on. @public */
export function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** A suppression reader for one marker word — a `/* <marker>: <rule> — <reason> *​/` comment on the line or the one above it. @public */
export function suppressedBy(marker: string): (lines: readonly string[], line: number, ruleId: string) => boolean {
  return (lines, line, ruleId) => {
    const pattern = new RegExp(`/\\*\\s*${marker}:\\s*${ruleId}\\s+—\\s+(?!\\*/)\\S`);
    return [lines[line - 1], lines[line - 2]].some((candidate) => candidate !== undefined && pattern.test(candidate));
  };
}

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

/** The index just past a regex literal opened at `start`, or -1 when it is a division sign after all. */
function endOfRegex(source: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "\n") return -1;
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      let end = i + 1;
      while (end < source.length && /[a-z]/i.test(source[end] ?? "")) end++;
      return end;
    }
  }
  return -1;
}

// `<` and `>` are not openers, whatever they are in JavaScript: in a `.tsx` file the `/` after one
// closes a JSX tag, and reading `</p>` as a regex swallows the `//` comment on the same line.
/** Whether a `/` opens a regex literal rather than dividing, decided from the token before it. */
const OPENS_REGEX = /(?:=>|[({[,;:=!&|?+\-*%~^]|\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await))\s*$/;

// One pass over strings, regex literals and comments together, so none can start inside another —
// including the odd backtick inside a regex, which a regex-blind lexer reads as a template opener.
function scan(source: string, lineComments: boolean): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let line = 1;
  let counted = 0;
  const lineOf = (index: number): number => {
    for (; counted < index; counted++) {
      if (source[counted] === "\n") line++;
    }
    return line;
  };

  // The last 16 code characters, which is all `OPENS_REGEX` needs and all a comment leaves untouched.
  let tail = "";

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "'" || char === '"' || char === "`") {
      const end = endOfQuoted(source, i);
      if (end !== -1) {
        i = end - 1;
        tail = "x";
        continue;
      }
      tail = (tail + char).slice(-16);
      continue;
    }
    if (char !== "/") {
      tail = (tail + char).slice(-16);
      continue;
    }

    const next = source[i + 1];
    if (next === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? source.length : close + 2;
      spans.push({ kind: "block", start: i, end, line: lineOf(i), text: source.slice(i, end) });
      i = end - 1;
      continue;
    }
    if (lineComments && next === "/") {
      const lineEnd = source.indexOf("\n", i);
      const end = lineEnd === -1 ? source.length : lineEnd;
      spans.push({ kind: "line", start: i, end, line: lineOf(i), text: source.slice(i, end) });
      i = end - 1;
      continue;
    }

    // Only for TypeScript: a CSS `url(/path/x.png)` would read as one, and CSS has no regex literal.
    if (lineComments && (tail.trim() === "" || OPENS_REGEX.test(tail))) {
      const end = endOfRegex(source, i);
      if (end !== -1) {
        i = end - 1;
        tail = "x";
        continue;
      }
    }
    tail = (tail + char).slice(-16);
  }
  return spans;
}

function blank(source: string, lineComments: boolean): string {
  // Split by code unit, never by code point: every index in this file is a UTF-16 offset, and an
  // astral character reassembled from a code-point split would move every offset after it.
  const out = source.split("");
  for (const span of scan(source, lineComments)) {
    for (let j = span.start; j < span.end; j++) {
      if (out[j] !== "\n") out[j] = " ";
    }
  }
  return out.join("");
}

/** Every comment in `source`, in source order, each with its 1-indexed opening line. @public */
export function findComments(source: string): CommentSpan[] {
  return scan(source, true);
}

/** Replaces every block-comment body with spaces, so offsets and line numbers survive the blanking. @public */
export function blankComments(source: string): string {
  return blank(source, false);
}

/** `source` with block and `//` comments blanked space-for-space. @public */
export function blankSourceComments(source: string): string {
  return blank(source, true);
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
