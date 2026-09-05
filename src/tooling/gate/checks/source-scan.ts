import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, posix, relative, resolve, sep } from "node:path";

/** Every file under `dir` matching `accept`, repo-relative to `root`, posix-separated and sorted —
 *  so a finding's order and its path spelling do not depend on the filesystem. @public */
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

/** The 1-indexed line `index` falls on. @public */
export function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** A suppression reader for one marker word — a `/* <marker>: <rule> — <reason> *​/` comment on the
 *  line or the one above it. The reason is mandatory; a bare marker does not suppress. @public */
export function suppressedBy(marker: string): (lines: readonly string[], line: number, ruleId: string) => boolean {
  return (lines, line, ruleId) => {
    // `\S` alone is satisfied by the `*` of the closing `*/`, which would let a reasonless marker
    // suppress; the lookahead excludes it so the mandatory reason cannot be bypassed.
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

// One pass over strings and comments together, so neither can start inside the other: a `/*` inside
// a string literal opens no comment, and a quote inside a comment opens no string.
function blank(source: string, lineComments: boolean): string {
  // Split by code unit, never by code point: every index in this file is a UTF-16 offset, and an
  // astral character reassembled from a code-point split would move every offset after it.
  const out = source.split("");

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "'" || char === '"' || char === "`") {
      const end = endOfQuoted(source, i);
      if (end !== -1) i = end - 1;
      continue;
    }
    if (char !== "/") continue;

    const next = source[i + 1];
    if (next === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? source.length : close + 2;
      for (let j = i; j < end; j++) {
        if (out[j] !== "\n") out[j] = " ";
      }
      i = end - 1;
      continue;
    }
    if (!lineComments || next !== "/") continue;

    const lineEnd = source.indexOf("\n", i);
    const end = lineEnd === -1 ? source.length : lineEnd;
    for (let j = i; j < end; j++) out[j] = " ";
    i = end - 1;
  }
  return out.join("");
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
