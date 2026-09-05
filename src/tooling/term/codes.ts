// SGR code table and the level-degradation factory adapted from @visulima/colorize
// (MIT, Copyright (c) visulima), itself after ansis (ISC, Copyright (c) 2023 webdiscus)
// https://github.com/visulima/visulima — packages/terminal/colorize/src/ansi-codes.ts
// The RGB conversions are after color-convert (MIT, Copyright (c) Heather Arthur, Josh Junon).

import { ESC } from "./ansi";
import type { ColorLevel } from "./capability";

/** The pair of sequences that opens and closes one style. @public */
export interface ColorCode {
  open: string;
  close: string;
}

/** Every named colour, foreground and background. @public */
export type AnsiColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "grey"
  | "blackBright"
  | "redBright"
  | "greenBright"
  | "yellowBright"
  | "blueBright"
  | "magentaBright"
  | "cyanBright"
  | "whiteBright"
  | "bgBlack"
  | "bgRed"
  | "bgGreen"
  | "bgYellow"
  | "bgBlue"
  | "bgMagenta"
  | "bgCyan"
  | "bgWhite"
  | "bgGray"
  | "bgGrey"
  | "bgBlackBright"
  | "bgRedBright"
  | "bgGreenBright"
  | "bgYellowBright"
  | "bgBlueBright"
  | "bgMagentaBright"
  | "bgCyanBright"
  | "bgWhiteBright";

/** Every named non-colour attribute. @public */
export type AnsiStyle = "reset" | "bold" | "dim" | "italic" | "underline" | "inverse" | "hidden" | "strikethrough";

/** The style methods that take a value rather than a name. @public */
export interface ColorMethods {
  ansi256: (code: number) => ColorCode;
  bgAnsi256: (code: number) => ColorCode;
  rgb: (r: number, g: number, b: number) => ColorCode;
  bgRgb: (r: number, g: number, b: number) => ColorCode;
  hex: (value: string) => ColorCode;
  bgHex: (value: string) => ColorCode;
}

/** A whole code table, resolved for one colour level. @public */
export interface AnsiCodes {
  colors: Record<AnsiColor, ColorCode>;
  styles: Record<AnsiStyle, ColorCode>;
  methods: ColorMethods;
}

const FG_CLOSE = 39;
const BG_CLOSE = 49;
const BG_OFFSET = 10;
const HEX = /^#?([a-f\d]{3}|[a-f\d]{6})$/i;

/** Every key `Colorize` exposes as a chainable getter, in the order they are defined. @public */
export const COLOR_NAMES: readonly AnsiColor[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "grey",
  "blackBright",
  "redBright",
  "greenBright",
  "yellowBright",
  "blueBright",
  "magentaBright",
  "cyanBright",
  "whiteBright",
  "bgBlack",
  "bgRed",
  "bgGreen",
  "bgYellow",
  "bgBlue",
  "bgMagenta",
  "bgCyan",
  "bgWhite",
  "bgGray",
  "bgGrey",
  "bgBlackBright",
  "bgRedBright",
  "bgGreenBright",
  "bgYellowBright",
  "bgBlueBright",
  "bgMagentaBright",
  "bgCyanBright",
  "bgWhiteBright",
];

/** Every non-colour attribute `Colorize` exposes. @public */
export const STYLE_NAMES: readonly AnsiStyle[] = ["reset", "bold", "dim", "italic", "underline", "inverse", "hidden", "strikethrough"];

/** The 3- or 6-digit hex string as RGB, falling back to black on anything unparseable. @public */
export function hexToRgb(value: string): [number, number, number] {
  const matched = HEX.exec(value)?.[1];
  if (matched === undefined) return [0, 0, 0];
  const full = matched.length === 3 ? [...matched].map((c) => c + c).join("") : matched;
  const packed = Number.parseInt(full, 16);
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
}

/** The nearest of the 256 palette entries to an RGB triple. @public */
export function rgbToAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return 16 + 36 * Math.round(r / 51) + 6 * Math.round(g / 51) + Math.round(b / 51);
}

/** The nearest of the 16 basic foreground codes to a 256-palette entry. @public */
export function ansi256To16(code: number): number {
  if (code < 8) return 30 + code;
  if (code < 16) return 90 + (code - 8);

  let r: number;
  let g: number;
  let b: number;
  if (code >= 232) {
    r = g = b = ((code - 232) * 10 + 8) / 255;
  } else {
    const offset = code - 16;
    const remainder = offset % 36;
    r = Math.floor(offset / 36) / 5;
    g = Math.floor(remainder / 6) / 5;
    b = (remainder % 6) / 5;
  }

  const value = Math.max(r, g, b) * 2;
  if (value === 0) return 30;
  const basic = 30 + ((Math.round(b) << 2) | (Math.round(g) << 1) | Math.round(r));
  return value === 2 ? basic + 60 : basic;
}

const NONE: ColorCode = { open: "", close: "" };

/** The SGR table for one colour level, degrading each request to what that level can carry. @public */
export function createAnsiCodes(level: ColorLevel): AnsiCodes {
  const esc: (open: number | string, close: number) => ColorCode =
    level > 0 ? (open, close) => ({ open: `${ESC}[${open}m`, close: `${ESC}[${close}m` }) : () => NONE;

  const fg = (code: number) => esc(code, FG_CLOSE);
  const bg = (code: number) => esc(code + BG_OFFSET, BG_CLOSE);

  const colors = {} as Record<AnsiColor, ColorCode>;
  const NAMED = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
  NAMED.forEach((name, i) => {
    colors[name as AnsiColor] = fg(30 + i);
    colors[`${name}Bright` as AnsiColor] = fg(90 + i);
    colors[`bg${name[0]?.toUpperCase()}${name.slice(1)}` as AnsiColor] = bg(30 + i);
    colors[`bg${name[0]?.toUpperCase()}${name.slice(1)}Bright` as AnsiColor] = bg(90 + i);
  });
  // `gray`/`grey` are the two spellings of bright black; both are aliases, not a fourth colour.
  colors.gray = colors.blackBright;
  colors.grey = colors.blackBright;
  colors.bgGray = colors.bgBlackBright;
  colors.bgGrey = colors.bgBlackBright;

  const styles: Record<AnsiStyle, ColorCode> = {
    reset: esc(0, 0),
    // 21 is not widely supported and 22 closes bold and dim alike.
    bold: esc(1, 22),
    dim: esc(2, 22),
    italic: esc(3, 23),
    underline: esc(4, 24),
    inverse: esc(7, 27),
    hidden: esc(8, 28),
    strikethrough: esc(9, 29),
  };

  let ansi256 = (code: number) => esc(`38;5;${code}`, FG_CLOSE);
  let bgAnsi256 = (code: number) => esc(`48;5;${code}`, BG_CLOSE);
  let rgb = (r: number, g: number, b: number) => esc(`38;2;${r};${g};${b}`, FG_CLOSE);
  let bgRgb = (r: number, g: number, b: number) => esc(`48;2;${r};${g};${b}`, BG_CLOSE);

  if (level === 1) {
    ansi256 = (code) => esc(ansi256To16(code), FG_CLOSE);
    bgAnsi256 = (code) => esc(ansi256To16(code) + BG_OFFSET, BG_CLOSE);
    rgb = (r, g, b) => esc(ansi256To16(rgbToAnsi256(r, g, b)), FG_CLOSE);
    bgRgb = (r, g, b) => esc(ansi256To16(rgbToAnsi256(r, g, b)) + BG_OFFSET, BG_CLOSE);
  } else if (level === 2) {
    rgb = (r, g, b) => ansi256(rgbToAnsi256(r, g, b));
    bgRgb = (r, g, b) => bgAnsi256(rgbToAnsi256(r, g, b));
  }

  return {
    colors,
    styles,
    methods: { ansi256, bgAnsi256, rgb, bgRgb, hex: (value) => rgb(...hexToRgb(value)), bgHex: (value) => bgRgb(...hexToRgb(value)) },
  };
}
