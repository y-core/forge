import { describe, expect, test } from "bun:test";

import { minimumWidth, preferredWidth } from "./measure";
import { textWidth, wrapText } from "./text";
import type { PdfEmbeddedFont, PdfEmbeddedMetrics } from "./types";
import { BASE14_TYPESETTING, resolveTypesetting } from "./typesetting";

// Every mark the base-14 pair sets, in one string: the whole WinAnsi repertoire is what the
// delegation has to agree over, not a sample of it that could miss the one character that drifts.
const CORPUS = [
  " !\"#$%&'()*+,-./0123456789:;<=>?@",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`",
  "abcdefghijklmnopqrstuvwxyz{|}~",
  " ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿",
  "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß",
  "àáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
  "€‚ƒ„…†‡ˆ‰Š‹Œ Ž‘’“”•–—˜™š›œ žŸ",
].join("");

const METRICS: PdfEmbeddedMetrics = {
  unitsPerEm: 1000,
  ascent: 1193,
  descent: -289,
  bbox: [-100, -300, 1100, 1200],
  advances: new Map([...CORPUS].map((character) => [character.codePointAt(0) ?? 0, 900])),
};

const REGULAR: PdfEmbeddedFont = {
  name: "display",
  postScriptName: "Display-Regular",
  sfnt: new Uint8Array(),
  glyphs: new Map(),
  metrics: METRICS,
};

const BOLD: PdfEmbeddedFont = {
  ...REGULAR,
  name: "display-bold",
  postScriptName: "Display-Bold",
  metrics: { ...METRICS, advances: new Map([...CORPUS].map((character) => [character.codePointAt(0) ?? 0, 1100])) },
};

const FONTS = [REGULAR, BOLD];
const PAIR = { regular: "display", bold: "display-bold" };

describe("BASE14_TYPESETTING", () => {
  test("measures every mark of the repertoire exactly as `textWidth` does, in both weights", () => {
    for (const character of CORPUS) {
      expect(BASE14_TYPESETTING.width(character, 10)).toBe(textWidth(character, 10));
      expect(BASE14_TYPESETTING.width(character, 10, { bold: true })).toBe(textWidth(character, 10, { bold: true }));
    }
  });

  test("breaks a run exactly where `wrapText` breaks it, `breakWord` and all", () => {
    expect(BASE14_TYPESETTING.wrap(CORPUS, 9, 120)).toEqual(wrapText(CORPUS, 9, 120));
    expect(BASE14_TYPESETTING.wrap(CORPUS, 9, 20, {}, true)).toEqual(wrapText(CORPUS, 9, 20, {}, true));
  });

  test("answers `preferred` and `minimum` with the functions that own them", () => {
    const paragraph = "Declaration of interest\nand of every beneficial owner";

    expect(BASE14_TYPESETTING.preferred(paragraph, 9)).toBe(preferredWidth(paragraph, 9));
    expect(BASE14_TYPESETTING.minimum(paragraph, 9)).toBe(minimumWidth(paragraph, 9));
  });

  test("names no embedded face for either weight, which is what makes a run take the base-14 pair", () => {
    expect(BASE14_TYPESETTING.embedded("regular")).toBeUndefined();
    expect(BASE14_TYPESETTING.embedded("bold")).toBeUndefined();
  });
});

describe("resolveTypesetting", () => {
  test("is the base-14 pair where no default face is named, whatever fonts are carried", () => {
    expect(resolveTypesetting(undefined, undefined)).toBe(BASE14_TYPESETTING);
    expect(resolveTypesetting(FONTS, undefined)).toBe(BASE14_TYPESETTING);
  });

  test("measures in the named face's own advances rather than Helvetica's", () => {
    const set = resolveTypesetting(FONTS, PAIR);

    expect(set.width("AAA", 10)).toBeCloseTo(27, 9);
    expect(set.width("AAA", 10)).not.toBeCloseTo(textWidth("AAA", 10), 3);
  });

  test("measures a bold run in the bold face, which is the distinction a single default would lose", () => {
    const set = resolveTypesetting(FONTS, PAIR);

    expect(set.width("AAA", 10, { bold: true })).toBeCloseTo(33, 9);
    expect(set.embedded("bold")).toBe(BOLD);
    expect(set.embedded("regular")).toBe(REGULAR);
  });

  test("breaks a line where the embedded advances put it, not where Helvetica's would", () => {
    const set = resolveTypesetting(FONTS, PAIR);

    expect(set.wrap("AA AA AA", 10, 30)).toEqual(["AA", "AA", "AA"]);
    expect(wrapText("AA AA AA", 10, 30)).toEqual(["AA AA", "AA"]);
  });

  test("falls back to the base-14 pair where a named face is absent, the refusal being prepare's", () => {
    expect(resolveTypesetting(FONTS, { regular: "display", bold: "absent" })).toBe(BASE14_TYPESETTING);
    expect(resolveTypesetting(undefined, PAIR)).toBe(BASE14_TYPESETTING);
  });
});
