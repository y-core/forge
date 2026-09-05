// Range tables and the OSC 8 rule transcribed from @visulima/string (MIT, Copyright (c) visulima)
// https://github.com/visulima/visulima — packages/data-manipulation/string/src/get-string-truncated-width.ts

import { ANSI_PATTERN, CSI, ESC, hasAnsi, RESET } from "./ansi";

/** How many columns each class of character is counted as occupying. @public */
export interface WidthOptions {
  /** Columns a tab advances. Defaults to 8. */
  tabWidth?: number;
  /** Columns an emoji sequence occupies. Defaults to 2. */
  emojiWidth?: number;
  /** Columns an East-Asian wide character occupies. Defaults to 2. */
  wideWidth?: number;
  /** Columns everything else occupies. Defaults to 1. */
  regularWidth?: number;
}

/** What `truncate` returns: the cut text, its width, and whether anything was dropped. @public */
export interface TruncateResult {
  text: string;
  width: number;
  truncated: boolean;
  /** Offset into `input` the cut was made at, before any reset or ellipsis was appended. */
  index: number;
}

/** Width options plus the marker written in place of what was cut. @public */
export interface TruncateOptions extends WidthOptions {
  /** Appended when the input does not fit. Defaults to `"…"`. */
  ellipsis?: string;
}

interface Metrics {
  tab: number;
  emoji: number;
  wide: number;
  regular: number;
}

const BEL = "\u0007";
const OSC8 = `${ESC}]8;;`;
const OSC8_CLOSER = `${OSC8}${BEL}`;

// Sticky, so the scanner anchors *at* `lastIndex`: a `g`-flagged clone would search *from* it and
// swallow every visible character before the next match.
const RE_ANSI_STICKY = new RegExp(ANSI_PATTERN, "y");

// Requiring emoji presentation — by default or forced by VS16 — is what keeps a text-default
// pictograph such as `©` at one column.
const EMOJI_ATOM =
  "(?:\\p{Regional_Indicator}\\p{Regional_Indicator}|(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)\\p{Emoji_Modifier}?)";

// A whole sequence: atoms joined by ZWJ, which a terminal draws as a single cluster.
const RE_EMOJI_STICKY = new RegExp(`${EMOJI_ATOM}(?:\\u200D${EMOJI_ATOM})*`, "uy");

// Combining marks, variation selectors and diacritics: zero width, because a terminal draws them
// onto the preceding cell rather than beside it.
const COMBINING: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06ed],
  [0x08e4, 0x08fe],
  [0x0900, 0x0903],
  [0x093a, 0x094f],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x0981, 0x0983],
  [0x09bc, 0x09c4],
  [0x09cd, 0x09cd],
  [0x0a01, 0x0a03],
  [0x0a3c, 0x0a4d],
  [0x0e31, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x0eb1, 0x0eb9],
  [0x0ebb, 0x0ebc],
  [0x0ec8, 0x0ecd],
  [0x0f35, 0x0f35],
  [0x0f37, 0x0f37],
  [0x0f39, 0x0f39],
  [0x0f71, 0x0f7e],
  [0x0f80, 0x0f84],
  [0x0f86, 0x0f87],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xe0100, 0xe01ef],
];

// East-Asian wide and full-width blocks. Box drawing (U+2500–257F) and the horizontal ellipsis
// (U+2026) fall outside every range deliberately, so a grid can measure the borders it draws.
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x11ff],
  [0x2e80, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xff00, 0xff60],
  [0xffa0, 0xffef],
];

const ZERO_WIDTH: readonly number[] = [0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff];

function inRanges(code: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const [lo, hi] of ranges) {
    if (code < lo) return false;
    if (code <= hi) return true;
  }
  return false;
}

function metrics(options: WidthOptions | undefined): Metrics {
  return { tab: options?.tabWidth ?? 8, emoji: options?.emojiWidth ?? 2, wide: options?.wideWidth ?? 2, regular: options?.regularWidth ?? 1 };
}

/** Where an OSC 8 hyperlink ends, and the text it displays — or `null` if it is not one. */
function readLink(input: string, index: number): { text: string; end: number } | null {
  if (!input.startsWith(OSC8, index)) return null;
  const paramsEnd = input.indexOf(BEL, index + OSC8.length);
  if (paramsEnd === -1) return null;
  const closer = input.indexOf(OSC8_CLOSER, paramsEnd + 1);
  if (closer === -1) return null;
  return { text: input.slice(paramsEnd + 1, closer), end: closer + OSC8_CLOSER.length };
}

/**
 * The one linear scan every export here is built from.
 *
 * Returns the width consumed, and `index` — where the scan stopped because the next character
 * would have pushed it past `limit`. Callers that only want a width pass an infinite limit; the
 * ones that want to cut read `index` and never measure the string a second time.
 */
function scan(input: string, limit: number, cfg: Metrics): { width: number; index: number; truncated: boolean } {
  const { length } = input;
  const escapes = hasAnsi(input);
  let index = 0;
  let width = 0;

  while (index < length) {
    if (escapes && (input[index] === ESC || input[index] === CSI)) {
      const link = readLink(input, index);
      if (link !== null) {
        const inner = scan(link.text, Number.POSITIVE_INFINITY, cfg).width;
        if (width + inner > limit) return { width, index, truncated: true };
        width += inner;
        index = link.end;
        continue;
      }
      RE_ANSI_STICKY.lastIndex = index;
      if (RE_ANSI_STICKY.test(input)) {
        index = RE_ANSI_STICKY.lastIndex;
        continue;
      }
    }

    const code = input.codePointAt(index) as number;
    let step = code > 0xffff ? 2 : 1;
    let cell: number;

    if (code === 9) {
      cell = cfg.tab;
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      cell = 0;
    } else if (code < 0x7f) {
      cell = cfg.regular;
    } else if (ZERO_WIDTH.includes(code) || inRanges(code, COMBINING)) {
      cell = 0;
    } else {
      RE_EMOJI_STICKY.lastIndex = index;
      const emoji = RE_EMOJI_STICKY.exec(input);
      if (emoji !== null) {
        cell = cfg.emoji;
        step = emoji[0].length;
      } else {
        cell = inRanges(code, WIDE) ? cfg.wide : cfg.regular;
      }
    }

    if (width + cell > limit) return { width, index, truncated: true };
    width += cell;
    index += step;
  }

  return { width, index: length, truncated: false };
}

/** The columns a terminal spends on `input`, ignoring escape sequences it never draws. @public */
export function stringWidth(input: string, options?: WidthOptions): number {
  if (input.length === 0) return 0;
  return scan(input, Number.POSITIVE_INFINITY, metrics(options)).width;
}

/**
 * Cuts `input` down to `limit` columns, appending an ellipsis in place of what was dropped.
 *
 * Returns the width alongside the text: every caller here is about to lay the result out in a
 * column, and measuring the same string twice is how the two disagree.
 * @public
 */
export function truncate(input: string, limit: number, options: TruncateOptions = {}): TruncateResult {
  const cfg = metrics(options);
  const full = scan(input, Number.POSITIVE_INFINITY, cfg);
  if (full.width <= limit) return { text: input, width: full.width, truncated: false, index: input.length };

  const requested = options.ellipsis ?? "…";
  const requestedWidth = scan(requested, Number.POSITIVE_INFINITY, cfg).width;
  // An ellipsis wider than the column would report a width above the limit it was asked to fit
  // in, so below that threshold the cut is silent rather than marked.
  const marked = requestedWidth <= limit;
  const ellipsis = marked ? requested : "";
  const ellipsisWidth = marked ? requestedWidth : 0;

  const cut = scan(input, Math.max(0, limit - ellipsisWidth), cfg);
  const head = input.slice(0, cut.index);
  return { text: `${head}${hasAnsi(head) ? RESET : ""}${ellipsis}`, width: cut.width + ellipsisWidth, truncated: true, index: cut.index };
}
