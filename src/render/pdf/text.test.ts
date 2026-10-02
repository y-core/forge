import { describe, expect, test } from "bun:test";

import { num, pdfName, pdfString, pdfTextString, textWidth, uncovered, winAnsiByte, wrapText } from "./text";

// The WinAnsi points above U+00FF, which a Latin-1 range walk never reaches.
const ABOVE_LATIN1 = [
  0x20ac, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x17d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013,
  0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x17e, 0x178,
];

describe("num", () => {
  test("writes at most three decimals and trims the trailing zero run", () => {
    expect(num(595)).toBe("595");
    expect(num(0)).toBe("0");
    expect(num(0.5)).toBe("0.5");
    expect(num(1.1)).toBe("1.1");
    expect(num(30.517578125)).toBe("30.518");
  });
});

// A text string is not a content-stream string: a literal with no marker is read as PDFDocEncoding,
// which disagrees with WinAnsi exactly where a real title's quotes and dashes live.
describe("pdfTextString", () => {
  test("stays a bare literal while it is ASCII, so nothing already written moves", () => {
    expect(pdfTextString("Declaration of interest")).toBe("(Declaration of interest)");
  });

  test("escapes that literal exactly as a content-stream string is escaped", () => {
    expect(pdfTextString("A (draft)")).toBe("(A \\(draft\\))");
  });

  test("writes a typographic quote or dash as UTF-16BE, since a reader would decode it wrongly", () => {
    expect(pdfTextString("a—b’c")).toBe("<FEFF00612014006220190063>");
  });

  test("carries a character WinAnsi cannot, which is what a text string is free to do", () => {
    expect(pdfTextString("価")).toBe("<FEFF4FA1>");
  });

  test("leads with the marker that says which encoding it is in", () => {
    expect(pdfTextString("é").startsWith("<FEFF")).toBe(true);
  });
});

describe("pdfString", () => {
  test("escapes the characters that would otherwise close or continue a literal string", () => {
    expect(pdfString("a(b)c\\d")).toBe("a\\(b\\)c\\\\d");
  });

  test("leaves the printable ASCII range exactly as it was given", () => {
    expect(pdfString("Du Toit 123 - +27 82")).toBe("Du Toit 123 - +27 82");
  });

  test("writes a WinAnsi special as an octal escape", () => {
    expect(pdfString("a—b’c“d”e")).toBe("a\\227b\\222c\\223d\\224e");
  });

  test("passes a Latin-1 letter through as its own byte", () => {
    expect(pdfString("Vlëer")).toBe("Vl\\353er");
  });

  test("refuses a character WinAnsi cannot carry, rather than substituting punctuation for it", () => {
    expect(() => pdfString("価")).toThrow("U+4FA1");
  });
});

describe("textWidth", () => {
  test("measures Helvetica to its own advance widths", () => {
    expect(textWidth("Financial", 9)).toBeCloseTo(36.009, 3);
    expect(textWidth("WAVE", 9)).toBeCloseTo(26.505, 3);
  });

  test("measures the bold face as itself, which is the wider of the two", () => {
    expect(textWidth("Signature", 9, { bold: true })).toBeCloseTo(41.508, 3);
  });

  test("adds tracking once per character, so a tracked run measures wider than its glyphs", () => {
    expect(textWidth("AAA", 10, { tracking: 2 })).toBeCloseTo(textWidth("AAA", 10) + 6, 6);
  });

  // Every number below is the `WX` its glyph carries in Adobe's `Helvetica.afm`.
  test("measures an accented capital to its own AFM advance", () => {
    expect(textWidth("Ö", 10)).toBeCloseTo(7.78, 6);
    expect(textWidth("Ä", 10)).toBeCloseTo(6.67, 6);
    expect(textWidth("Ü", 10)).toBeCloseTo(7.22, 6);
    expect(textWidth("é", 10)).toBeCloseTo(textWidth("e", 10), 9);
  });

  test("measures the ligatures and the letters no accent builds", () => {
    expect(textWidth("ß", 10)).toBeCloseTo(6.11, 6);
    expect(textWidth("æ", 10)).toBeCloseTo(8.89, 6);
    expect(textWidth("Ø", 10)).toBeCloseTo(7.78, 6);
    expect(textWidth("œ", 10)).toBeCloseTo(9.44, 6);
  });

  test("carries no glyph WinAnsi cannot encode, however well the AFM knows it", () => {
    // dotlessi and lslash have AFM advances and no WinAnsi code point, so they are refused, not set.
    expect(uncovered("ı")).toBe(0x131);
    expect(uncovered("ł")).toBe(0x142);
  });

  test("measures the bold face to its own table, which differs from the roman's", () => {
    expect(textWidth("¦", 10, { bold: true })).toBeCloseTo(2.8, 6);
    expect(textWidth("°", 10, { bold: true })).toBeCloseTo(4, 6);
    expect(textWidth("œ", 10, { bold: true })).toBeCloseTo(9.44, 6);
  });
});

describe("wrapText", () => {
  test("breaks on words at the width the point size fits", () => {
    expect(wrapText("one two three four", 10, 60)).toEqual(["one two", "three four"]);
  });

  test("keeps an explicit newline as its own line", () => {
    expect(wrapText("first\nsecond", 10, 600)).toEqual(["first", "second"]);
  });

  test("lets a word wider than its column overrun, rather than cutting it in half by default", () => {
    expect(wrapText("aaaaaaaaaa", 10, 30)).toEqual(["aaaaaaaaaa"]);
  });

  test("cuts an over-long word only where the caller asks for it", () => {
    expect(wrapText("aaaaaaaaaa", 10, 30, {}, true)).toEqual(["aaaaa", "aaaaa"]);
  });

  test("keeps the words around an over-long one on their own lines either way", () => {
    expect(wrapText("one aaaaaaaaaa two", 10, 30)).toEqual(["one", "aaaaaaaaaa", "two"]);
  });

  test("returns one empty line for empty text, so a blank value still occupies its row", () => {
    expect(wrapText("", 10, 100)).toEqual([""]);
  });
});

describe("coverage", () => {
  test("reports nothing for a run the base-14 faces can set", () => {
    expect(uncovered("Du Toit — Ö, æ, ß")).toBeUndefined();
  });

  test("names the first code point they cannot", () => {
    expect(uncovered("a 価 b")).toBe(0x4fa1);
  });

  // Walks what `winAnsiByte` accepts rather than a Unicode range, so the 0x80-0x9F block — where
  // WinAnsi and Latin-1 differ, and where an omission hides — is visited too.
  test("covers every code point WinAnsi carries, in both faces", () => {
    const points = [...Array.from({ length: 0xe0 }, (_value, at) => at + 0x20), ...ABOVE_LATIN1];
    let checked = 0;
    for (const code of points) {
      const character = String.fromCodePoint(code);
      if (winAnsiByte(code) === undefined) continue;
      expect(uncovered(character)).toBeUndefined();
      expect(textWidth(character, 10)).toBeGreaterThan(0);
      expect(textWidth(character, 10, { bold: true })).toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(200);
  });

  test("carries the low quotes the 0x80-0x9F block adds over Latin-1", () => {
    expect(uncovered("‚„")).toBeUndefined();
    expect(textWidth("‚", 10)).toBeCloseTo(2.22, 6);
    expect(textWidth("„", 10)).toBeCloseTo(3.33, 6);
  });
});

describe("a name object ends at the first delimiter, so everything else is written #xx", () => {
  test("escapes the space that would otherwise end the name and leave a stray token", () => {
    expect(pdfName("Arimo Regular")).toBe("Arimo#20Regular");
  });

  test("escapes the delimiters and the number sign itself, and leaves a plain name alone", () => {
    expect(pdfName("A/B(C)#D")).toBe("A#2fB#28C#29#23D");
    expect(pdfName("Oswald-Regular")).toBe("Oswald-Regular");
  });

  test("writes a character outside ASCII as the UTF-8 bytes PDF names it by", () => {
    expect(pdfName("Æon")).toBe("#c3#86on");
  });
});
