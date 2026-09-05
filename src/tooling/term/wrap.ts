// `padAlign` adapted from @visulima/tabular (MIT, Copyright (c) visulima)
// https://github.com/visulima/visulima — packages/terminal/tabular/src/utils/pad-and-align-content.ts

import { hasAnsi, RESET, SGR_PATTERN } from "./ansi";
import { stringWidth, truncate, type WidthOptions } from "./width";

/** Where the shorter side's padding goes when a cell is wider than its content. @public */
export type Align = "left" | "center" | "right";

/** Pads `input` out to `width` columns as `stringWidth` measures it, putting the slack where `align` says. @public */
export function padAlign(input: string, width: number, align: Align = "left", options?: WidthOptions): string {
  const slack = Math.max(0, width - stringWidth(input, options));
  if (slack === 0) return input;
  if (align === "right") return " ".repeat(slack) + input;
  if (align === "center") {
    const left = Math.floor(slack / 2);
    return " ".repeat(left) + input + " ".repeat(slack - left);
  }
  return input + " ".repeat(slack);
}

/** Breaks one over-long word across as many lines as it needs, cutting on column boundaries. */
function hardBreak(word: string, width: number, options: WidthOptions | undefined, out: string[]): string {
  let rest = word;
  while (stringWidth(rest, options) > width) {
    const head = truncate(rest, width, { ...options, ellipsis: "" });
    // A zero-width head would loop forever — it means `width` cannot hold even one cell, and the
    // caller gets the remainder whole rather than an empty line per character.
    if (head.index === 0) return rest;
    out.push(head.text);
    // Sliced by the cut offset, not by `head.text.length`: the text carries a RESET this call never
    // asked for whenever the head bears an escape, and slicing by its length eats four characters.
    rest = rest.slice(head.index);
  }
  return rest;
}

// SGR sequences only: the ones that change how the following text is drawn, and so the only ones
// whose state has to survive a line break.
const RE_SGR = new RegExp(SGR_PATTERN, "g");

/** Which open codes a closing code cancels. `0` cancels everything. */
function cancels(closer: number, open: number): boolean {
  if (closer === 0) return true;
  if (closer === 39) return (open >= 30 && open <= 38) || (open >= 90 && open <= 97);
  if (closer === 49) return (open >= 40 && open <= 48) || (open >= 100 && open <= 107);
  if (closer === 22) return open === 1 || open === 2;
  return closer - 20 === open;
}

const CLOSERS = new Set([0, 22, 23, 24, 27, 28, 29, 39, 49]);

/** Reopens on each line whatever was still open when the previous one ended, and closes it again. */
function rebalance(lines: readonly string[]): string[] {
  let active: { raw: string; code: number }[] = [];

  return lines.map((line) => {
    const prefix = active.map((entry) => entry.raw).join("");
    for (const match of line.matchAll(RE_SGR)) {
      const raw = match[0];
      const code = Number.parseInt(match[1] ?? "0", 10) || 0;
      if (CLOSERS.has(code)) active = active.filter((entry) => !cancels(code, entry.code));
      else active.push({ raw, code });
    }
    return active.length === 0 && prefix === "" ? line : `${prefix}${line}${active.length === 0 ? "" : RESET}`;
  });
}

/** Wraps `input` to `width` columns, greedily and on spaces, returning one string per line. @public */
export function wrapLines(input: string, width: number, options?: WidthOptions): string[] {
  if (width <= 0) return input.split("\n");

  const lines: string[] = [];
  for (const paragraph of input.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (stringWidth(candidate, options) <= width) {
        current = candidate;
        continue;
      }
      if (current !== "") lines.push(current);
      current = stringWidth(word, options) > width ? hardBreak(word, width, options, lines) : word;
    }
    lines.push(current);
  }

  return hasAnsi(input) ? rebalance(lines) : lines;
}
