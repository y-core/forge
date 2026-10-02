import type { TextStyle } from "./types";

// Adobe's Core 14 advance widths, per 1000 units of the em, taken from `Helvetica.afm` and
// `Helvetica-Bold.afm` and keyed by WinAnsi code point — the encoding these faces are written with.
const HELVETICA: readonly (readonly [number, string])[] = [
  [191, "\u0027"],
  [222, "\u0069\u006a\u006c\u2018\u2019\u201a"],
  [260, "\u007c\u00a6"],
  [
    278,
    "\u0020\u0021\u002c\u002e\u002f\u003a\u003b\u0049\u005b\u005c\u005d\u0066\u0074\u00a0\u00b7\u00cc\u00cd\u00ce\u00cf\u00ec\u00ed\u00ee\u00ef",
  ],
  [333, "\u0028\u0029\u002d\u0060\u0072\u00a1\u00a8\u00ad\u00af\u00b2\u00b3\u00b4\u00b8\u00b9\u02c6\u02dc\u201c\u201d\u201e\u2039\u203a"],
  [334, "\u007b\u007d"],
  [350, "\u2022"],
  [355, "\u0022"],
  [365, "\u00ba"],
  [370, "\u00aa"],
  [389, "\u002a"],
  [400, "\u00b0"],
  [469, "\u005e"],
  [500, "\u004a\u0063\u006b\u0073\u0076\u0078\u0079\u007a\u00e7\u00fd\u00ff\u0161\u017e"],
  [537, "\u00b6"],
  [
    556,
    "\u0023\u0024\u0030\u0031\u0032\u0033\u0034\u0035\u0036\u0037\u0038\u0039\u003f\u004c\u005f\u0061\u0062\u0064\u0065\u0067\u0068\u006e\u006f\u0070\u0071\u0075\u00a2\u00a3\u00a4\u00a5\u00a7\u00ab\u00b5\u00bb\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e8\u00e9\u00ea\u00eb\u00f0\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f9\u00fa\u00fb\u00fc\u00fe\u0192\u2013\u2020\u2021\u20ac",
  ],
  [584, "\u002b\u003c\u003d\u003e\u007e\u00ac\u00b1\u00d7\u00f7"],
  [611, "\u0046\u0054\u005a\u00bf\u00df\u00f8\u017d"],
  [
    667,
    "\u0026\u0041\u0042\u0045\u004b\u0050\u0053\u0056\u0058\u0059\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c8\u00c9\u00ca\u00cb\u00dd\u00de\u0160\u0178",
  ],
  [722, "\u0043\u0044\u0048\u004e\u0052\u0055\u0077\u00c7\u00d0\u00d1\u00d9\u00da\u00db\u00dc"],
  [737, "\u00a9\u00ae"],
  [778, "\u0047\u004f\u0051\u00d2\u00d3\u00d4\u00d5\u00d6\u00d8"],
  [833, "\u004d\u006d"],
  [834, "\u00bc\u00bd\u00be"],
  [889, "\u0025\u00e6"],
  [944, "\u0057\u0153"],
  [1000, "\u00c6\u0152\u2014\u2026\u2030\u2122"],
  [1015, "\u0040"],
];

const HELVETICA_BOLD: readonly (readonly [number, string])[] = [
  [238, "\u0027"],
  [278, "\u0020\u002c\u002e\u002f\u0049\u005c\u0069\u006a\u006c\u00a0\u00b7\u00cc\u00cd\u00ce\u00cf\u00ec\u00ed\u00ee\u00ef\u2018\u2019\u201a"],
  [280, "\u007c\u00a6"],
  [
    333,
    "\u0021\u0028\u0029\u002d\u003a\u003b\u005b\u005d\u0060\u0066\u0074\u00a1\u00a8\u00ad\u00af\u00b2\u00b3\u00b4\u00b8\u00b9\u02c6\u02dc\u2039\u203a",
  ],
  [350, "\u2022"],
  [365, "\u00ba"],
  [370, "\u00aa"],
  [389, "\u002a\u0072\u007b\u007d"],
  [400, "\u00b0"],
  [474, "\u0022"],
  [500, "\u007a\u017e\u201c\u201d\u201e"],
  [
    556,
    "\u0023\u0024\u0030\u0031\u0032\u0033\u0034\u0035\u0036\u0037\u0038\u0039\u004a\u005f\u0061\u0063\u0065\u006b\u0073\u0076\u0078\u0079\u00a2\u00a3\u00a4\u00a5\u00a7\u00ab\u00b6\u00bb\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e7\u00e8\u00e9\u00ea\u00eb\u00fd\u00ff\u0161\u0192\u2013\u2020\u2021\u20ac",
  ],
  [584, "\u002b\u003c\u003d\u003e\u005e\u007e\u00ac\u00b1\u00d7\u00f7"],
  [
    611,
    "\u003f\u0046\u004c\u0054\u005a\u0062\u0064\u0067\u0068\u006e\u006f\u0070\u0071\u0075\u00b5\u00bf\u00df\u00f0\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f8\u00f9\u00fa\u00fb\u00fc\u00fe\u017d",
  ],
  [667, "\u0045\u0050\u0053\u0056\u0058\u0059\u00c8\u00c9\u00ca\u00cb\u00dd\u00de\u0160\u0178"],
  [
    722,
    "\u0026\u0041\u0042\u0043\u0044\u0048\u004b\u004e\u0052\u0055\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c7\u00d0\u00d1\u00d9\u00da\u00db\u00dc",
  ],
  [737, "\u00a9\u00ae"],
  [778, "\u0047\u004f\u0051\u0077\u00d2\u00d3\u00d4\u00d5\u00d6\u00d8"],
  [833, "\u004d"],
  [834, "\u00bc\u00bd\u00be"],
  [889, "\u0025\u006d\u00e6"],
  [944, "\u0057\u0153"],
  [975, "\u0040"],
  [1000, "\u00c6\u0152\u2014\u2026\u2030\u2122"],
];

function widths(groups: readonly (readonly [number, string])[]): ReadonlyMap<number, number> {
  const table = new Map<number, number>();
  for (const [width, characters] of groups) for (const character of characters) table.set(character.codePointAt(0) ?? 0, width);
  return table;
}

const REGULAR_WIDTHS = widths(HELVETICA);
const BOLD_WIDTHS = widths(HELVETICA_BOLD);

// The WinAnsi code points that are not Latin-1, so a document's dashes and curly quotes survive.
const WIN_ANSI: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

// A text string carrying no byte-order marker is read as PDFDocEncoding, which disagrees with
// WinAnsi across 0x80-0x9F — where the curly quotes and dashes a real title carries live.
/** A text string as PDF reads one: a bare literal while it is ASCII, UTF-16BE with a marker past it. @internal */
export function pdfTextString(value: string): string {
  if (!/[^ -~]/.test(value)) return `(${pdfString(value)})`;
  const units = Array.from({ length: value.length }, (_unit, at) => value.charCodeAt(at).toString(16).padStart(4, "0"));
  return `<FEFF${units.join("").toUpperCase()}>`;
}

// A name object ends at the first delimiter or space, so `Arimo Regular` written raw is `/Arimo` and
// a stray token after it — which is a dictionary the reader mis-parses rather than one it refuses.
/** A PDF name object's body, with everything outside the regular ASCII range written `#xx`. @internal */
export function pdfName(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code > 0x20 && code < 0x7f && !"#()<>[]{}/%".includes(character)) return character;
      return [...new TextEncoder().encode(character)].map((byte) => `#${byte.toString(16).padStart(2, "0")}`).join("");
    })
    .join("");
}

/** A number as a PDF operand: three decimals, with a trailing zero run trimmed. @internal */
export function num(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

/** The WinAnsi byte for a code point, or nothing where the encoding cannot carry it. @internal */
export function winAnsiByte(code: number): number | undefined {
  // The control range and DEL are not text: they carry no glyph and no advance, so a stray one is
  // refused by name rather than measuring as nothing and printing as an escape.
  if (code < 0x20 || code === 0x7f) return undefined;
  if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
  return WIN_ANSI.get(code);
}

/** A PDF literal string: WinAnsi bytes, with the structural characters and every high byte escaped. @internal */
export function pdfString(text: string): string {
  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const byte = winAnsiByte(code);
    // The renderer refuses an unencodable document before anything is written, so reaching this is a
    // broken invariant rather than bad input — and substituting would print a different word.
    if (byte === undefined) throw new Error(`pdfString: WinAnsi cannot carry U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

/** What one run occupies, in points, at the face and size it is set in. @internal */
export function textWidth(text: string, size: number, style: TextStyle = {}): number {
  const table = style.bold === true ? BOLD_WIDTHS : REGULAR_WIDTHS;
  let units = 0;
  let count = 0;
  for (const character of text) {
    units += table.get(character.codePointAt(0) ?? 0) ?? 0;
    count += 1;
  }
  return (units * size) / 1000 + (style.tracking ?? 0) * count;
}

/** The first code point in `text` that the base-14 faces cannot set, or nothing where all of them can. @internal */
export function uncovered(text: string): number | undefined {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (winAnsiByte(code) === undefined || !REGULAR_WIDTHS.has(code) || !BOLD_WIDTHS.has(code)) return code;
  }
  return undefined;
}

/** Greedy word wrap against any measurer, so every face breaks by the same rule. @internal */
export function wrapBy(text: string, width: number, widthOf: (run: string) => number, breakWord = false): string[] {
  const fits = (candidate: string): boolean => widthOf(candidate) <= width;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter((part) => part !== "")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line !== "") lines.push(line);
      // A word wider than its column overflows the measure unless the caller asks otherwise: in a
      // legal document a word silently cut in half reads as a different word.
      let rest = word;
      // The cut is at least one character, so a column narrower than a single glyph still terminates.
      while (breakWord && !fits(rest)) {
        let cut = 1;
        while (cut < rest.length && fits(rest.slice(0, cut + 1))) cut += 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** Greedy word wrap at the widest line the base-14 faces set inside `width`. @internal */
export function wrapText(text: string, size: number, width: number, style: TextStyle = {}, breakWord = false): string[] {
  return wrapBy(text, width, (run) => textWidth(run, size, style), breakWord);
}
