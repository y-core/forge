import { describe, expect, test } from "bun:test";

import { embedFont, glyphString, kernedArray, splitByFace } from "./embed";
import type { PdfEmbeddedFont } from "./types";
import { createObjectManager } from "./writer";

function fontOf(run: string): PdfEmbeddedFont {
  const codes = [...new Set([...run].map((character) => character.codePointAt(0) ?? 0))];
  return {
    name: "oswald",
    postScriptName: "Oswald-Regular",
    sfnt: new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x99]),
    glyphs: new Map(codes.map((code, index) => [code, index + 3])),
    metrics: { unitsPerEm: 1000, ascent: 1193, descent: -289, bbox: [-100, -300, 1100, 1200], advances: new Map(codes.map((code) => [code, 527])) },
  };
}

function bodiesOf(font: PdfEmbeddedFont): string[] {
  const manager = createObjectManager();
  embedFont(manager, font, manager.reserve());
  return manager.objects().map((object) => (typeof object.body === "string" ? object.body : object.body.head + object.body.tail));
}

describe("an embedded face is written as Type0 over CIDFontType2", () => {
  const bodies = bodiesOf(fontOf("Declaration"));
  const joined = bodies.join("\n");

  test("the font a page reaches is a Type0 with Identity-H encoding", () => {
    expect(joined).toContain("/Subtype /Type0");
    expect(joined).toContain("/Encoding /Identity-H");
  });

  test("its descendant is a CIDFontType2 with an identity CID-to-GID map", () => {
    expect(joined).toContain("/Subtype /CIDFontType2");
    expect(joined).toContain("/CIDToGIDMap /Identity");
    expect(joined).toContain("/Ordering (Identity)");
  });

  test("the face's bytes travel in a FontFile2 stream that declares its own length", () => {
    expect(joined).toContain("/FontFile2");
    expect(joined).toContain("/Length1 5");
  });

  test("every glyph carries its width, so the reader measures what the engine measured", () => {
    expect(joined).toMatch(/\/W \[[^\]]*3 \[527\]/);
    expect(joined).toContain("/DW 1000");
  });
});

describe("the ToUnicode CMap is what keeps the text selectable", () => {
  const joined = bodiesOf(fontOf("Du Toit")).join("\n");

  test("maps each glyph back to the code point it was set from", () => {
    expect(joined).toContain("/CMapName /Adobe-Identity-UCS");
    expect(joined).toContain("beginbfchar");
    // "D" is U+0044 and the first glyph allocated, so the pair is the one a reader copies through.
    expect(joined).toContain("<0003> <0044>");
  });

  test("declares the full two-byte code space Identity-H addresses", () => {
    expect(joined).toContain("<0000> <FFFF>");
  });

  test("splits its mappings into blocks of at most a hundred, which is the format's limit", () => {
    const many = fontOf([...Array.from({ length: 150 }, (_value, at) => String.fromCodePoint(0x41 + at))].join(""));
    const blocks =
      bodiesOf(many)
        .join("\n")
        .match(/beginbfchar/g) ?? [];
    expect(blocks.length).toBeGreaterThan(1);
  });
});

describe("glyphString", () => {
  test("writes a run as the glyph ids Identity-H addresses, two bytes each", () => {
    const font = fontOf("AB");
    expect(glyphString("AB", font.glyphs)).toBe("00030004");
  });

  test("raises for a code point the face does not cover, rather than drawing notdef", () => {
    expect(() => glyphString("Z", fontOf("AB").glyphs)).toThrow("U+005A");
  });
});

describe("a run is split at the code point, not dragged onto one face", () => {
  const latin = { name: "Oswald", covers: (code: number) => code < 0x2000 };
  const symbols = { name: "Symbols", covers: (code: number) => code >= 0x2000 && code < 0x3000 };

  test("keeps a run that one face covers whole", () => {
    expect(splitByFace("Declaration", [latin, symbols])).toEqual([{ face: "Oswald", run: "Declaration" }]);
  });

  test("splits only where the covering face changes", () => {
    expect(splitByFace("a—b", [latin, symbols])).toEqual([
      { face: "Oswald", run: "a" },
      { face: "Symbols", run: "—" },
      { face: "Oswald", run: "b" },
    ]);
  });

  test("leaves a code point no face covers on its own, without moving its neighbours", () => {
    expect(splitByFace("a価b", [latin])).toEqual([
      { face: "Oswald", run: "a" },
      { face: undefined, run: "価" },
      { face: "Oswald", run: "b" },
    ]);
  });

  test("prefers the first face that covers a point, so order is the precedence", () => {
    const other = { name: "Other", covers: () => true };
    expect(splitByFace("a", [latin, other])).toEqual([{ face: "Oswald", run: "a" }]);
    expect(splitByFace("a", [other, latin])).toEqual([{ face: "Other", run: "a" }]);
  });

  test("answers nothing for an empty run", () => {
    expect(splitByFace("", [latin])).toEqual([]);
  });
});

describe("kernedArray", () => {
  const kerned = (pairs: [string, number][]): PdfEmbeddedFont => {
    const font = fontOf("AVW");
    return { ...font, metrics: { ...font.metrics, kerning: new Map(pairs) } };
  };

  test("is one glyph group where the face kerns nothing", () => {
    const font = kerned([]);
    expect(kernedArray("AV", font)).toBe(`[<${glyphString("AV", font.glyphs)}>]`);
  });

  test("splits at a kerned pair and negates the adjustment, because TJ moves the pen back", () => {
    const font = kerned([["65,86", -40]]);
    const [a, v] = [glyphString("A", font.glyphs), glyphString("V", font.glyphs)];
    expect(kernedArray("AV", font)).toBe(`[<${a}> 40 <${v}>]`);
  });

  test("leaves an unkerned pair inside one group, so only real pairs cost a split", () => {
    const font = kerned([["65,86", -40]]);
    expect(kernedArray("VA", font)).toBe(`[<${glyphString("VA", font.glyphs)}>]`);
  });

  test("applies every pair in a longer run", () => {
    const font = kerned([
      ["65,86", -40],
      ["86,87", -20],
    ]);
    const [a, v, w] = [glyphString("A", font.glyphs), glyphString("V", font.glyphs), glyphString("W", font.glyphs)];
    expect(kernedArray("AVW", font)).toBe(`[<${a}> 40 <${v}> 20 <${w}>]`);
  });
});

describe("a PostScript name reaches the file as a name object rather than as it was typed", () => {
  test("escapes a space, so a two-word name cannot become a name plus a stray token", () => {
    const joined = bodiesOf({ ...fontOf("A"), postScriptName: "Arimo Regular" }).join("\n");
    expect(joined).toContain("/BaseFont /Arimo#20Regular");
    expect(joined).toContain("/FontName /Arimo#20Regular");
    expect(joined).not.toContain("/BaseFont /Arimo ");
  });
});

// The descriptor states every metric in glyph space, so the box has to be scaled where the ascent
// is. 2048 units per em is the ordinary TrueType value, which makes this the common case.
describe("a face measuring in other than 1000 units per em", () => {
  test("declares its bounding box in the same space as its ascent, not in its own units", () => {
    const font = fontOf("A");
    const scaled = { ...font, metrics: { ...font.metrics, unitsPerEm: 2048, bbox: [-1361, -665, 4096, 2060] as const } };
    const joined = bodiesOf(scaled).join("\n");
    expect(joined).toContain("/FontBBox [-664.551 -324.707 2000 1005.859]");
    expect(joined).toContain("/Ascent 582.52");
  });
});
