import { describe, expect, test } from "bun:test";

import { buildFontPacks, HARFBUZZ_SUBSET_WASM } from "../../tooling/assets/font-build";
import { Stack, Text } from "./components";
import { kernedArray } from "./embed";
import { readPdfEmbeddedFonts } from "./fonts/embedded";
import { embeddedWidth } from "./measure";
import { createPdfRenderer } from "./renderer";
import type { PdfDocument, PdfEmbeddedFont } from "./types";

const decoder = new TextDecoder("latin1");
const SOURCE = "node_modules/@expo-google-fonts/oswald/400Regular/Oswald_400Regular.ttf";
const CORPUS = "Declaration of interest AV";

const built = await buildFontPacks([{ family: "Oswald", from: SOURCE, to: "fonts/oswald-400.ttf", covering: CORPUS }], HARFBUZZ_SUBSET_WASM);

const FONT: PdfEmbeddedFont = readPdfEmbeddedFonts(
  built.packs[0]!,
  (path) => built.sfnt.get(path) ?? new Uint8Array(),
  () => "oswald",
)[0]!;

const codePoints = [...new Set([...CORPUS].map((character) => character.codePointAt(0) ?? 0))];

// The glyph ids the subset actually assigned — read off the built face, never guessed from order.
const glyphs = FONT.glyphs;

/** The glyph ids a `TJ` array carries, ignoring the kern numbers between its groups. */
function idsOf(stream: string): string {
  return [...stream.matchAll(/Td \[([^\]]+)\] TJ/g)]
    .flatMap((found) => [...(found[1] ?? "").matchAll(/<([\dA-F]+)>/g)].map((group) => group[1] ?? ""))
    .join("");
}

function documentOf(font: PdfEmbeddedFont | undefined): PdfDocument {
  return { title: "Declaration", content: [Stack({ children: [Text({ children: "Declaration of interest", font })] })] };
}

async function render(font: PdfEmbeddedFont | undefined): Promise<string> {
  const rendered = await createPdfRenderer({ compress: false, ...(font === undefined ? {} : { fonts: [font] }) }).render(documentOf(font));
  if (!rendered.ok) throw new Error(rendered.error.message);
  return decoder.decode(rendered.data);
}

describe("a document set in an embedded face", () => {
  test("writes the face as Type0 over CIDFontType2 with a ToUnicode CMap", async () => {
    const out = await render(FONT);
    expect(out).toContain("/Subtype /Type0");
    expect(out).toContain("/Subtype /CIDFontType2");
    expect(out).toContain("/Encoding /Identity-H");
    expect(out).toContain("/CMapName /Adobe-Identity-UCS");
  });

  test("names the face in the page's own font resources, beside the base-14 pair", async () => {
    const out = await render(FONT);
    const resources = /\/Font << ([^>]+) >>/.exec(out)?.[1] ?? "";
    expect(resources).toContain("/F1 3 0 R");
    expect(resources).toContain("/F2 4 0 R");
    expect(resources).toMatch(/\/E\d+ \d+ 0 R/);
  });

  test("sets the run as glyph ids rather than characters, which is what Identity-H addresses", async () => {
    const out = await render(FONT);
    expect(out).toMatch(/BT \/E\d+ [\d.]+ Tf [\d.]+ Tc [\d.]+ [\d.]+ Td \[[^\]]+\] TJ ET/);
    expect(out).not.toContain("(Declaration of interest) Tj");
  });

  test("a base-14 document is untouched by the feature, and still sets a literal string", async () => {
    const out = await render(undefined);
    expect(out).toContain("(Declaration of interest) Tj");
    expect(out).not.toContain("/Type0");
  });

  test("embeds the face's own bytes, so the file carries the subset it was built from", async () => {
    const rendered = await createPdfRenderer({ compress: false, fonts: [FONT] }).render(documentOf(FONT));
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.data.length).toBeGreaterThan(FONT.sfnt.length);
    expect(decoder.decode(rendered.data)).toContain(`/Length1 ${FONT.sfnt.length}`);
  });
});

describe("a code point the embedded face cannot set", () => {
  test("falls back to the base-14 faces where they can set it, rather than failing the document", async () => {
    // The subset covers no "ü"; WinAnsi does, so the run splits and the one character sets in Helvetica.
    const doc: PdfDocument = { title: "Declaration", content: [Text({ children: "Zürich", font: FONT })] };
    const rendered = await createPdfRenderer({ compress: false, fonts: [FONT] }).render(doc);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const out = decoder.decode(rendered.data);
    expect(out).toContain("(Z\\374) Tj");
  });

  test("is refused by name when no offered face and no base-14 face covers it", async () => {
    const doc: PdfDocument = { title: "Declaration", content: [Text({ children: "価", font: FONT })] };
    const rendered = await createPdfRenderer({ fonts: [FONT] }).render(doc);
    expect(rendered.ok).toBe(false);
    if (rendered.ok) return;
    expect(rendered.error.kind).toBe("encoding");
    expect(rendered.error.message).toContain("U+4FA1");
  });
});

describe("a run mixing two faces is split at the code point", () => {
  // A second face covering exactly what the first does not, so the split is forced rather than incidental.
  const OTHER: PdfEmbeddedFont = {
    ...FONT,
    name: "other",
    postScriptName: "Other-Regular",
    glyphs: new Map([[0x00fc, 9]]),
    metrics: { ...FONT.metrics, advances: new Map([[0x00fc, 500]]), kerning: new Map() },
  };

  async function streamOf(run: string): Promise<string> {
    const doc: PdfDocument = { title: "D", content: [Text({ children: run, font: [FONT, OTHER] })] };
    const rendered = await createPdfRenderer({ compress: false, fonts: [FONT, OTHER] }).render(doc);
    if (!rendered.ok) throw new Error(rendered.error.message);
    return decoder.decode(rendered.data);
  }

  test("renders, where a single face would have refused the whole document", async () => {
    const out = await streamOf("Dü");
    expect(out).toContain("TJ");
  });

  test("sets each stretch in the face that covers it, as separate runs", async () => {
    const out = await streamOf("Dü");
    const resources = [...out.matchAll(/BT \/(E\d+)/g)].map((found) => found[1]);
    expect(new Set(resources).size).toBe(2);
  });

  test("keeps a neighbour on its own face rather than dragging it across", async () => {
    const out = await streamOf("DüD");
    // Three runs: the first face, the second, then the first again — the middle point falls back alone.
    expect([...out.matchAll(/BT \/E\d+/g)]).toHaveLength(3);
  });

  test("a run one face covers entirely stays one run", async () => {
    const out = await streamOf("Declaration");
    expect([...out.matchAll(/BT \/E\d+/g)]).toHaveLength(1);
  });
});

describe("kerning reaches measurement, not only the artifact", () => {
  test("a kerned pair measures narrower in the embedded face than its advances alone", () => {
    const kerned = Text({ children: "AV", font: FONT }).measure(1000).preferred;
    const unkerned = Text({ children: "AV", font: { ...FONT, metrics: { ...FONT.metrics, kerning: new Map() } } }).measure(1000).preferred;
    expect(FONT.metrics.kerning?.get("65,86")).toBeLessThan(0);
    expect(kerned).toBeLessThan(unkerned);
  });
});

describe("the glyph ids are the subset's own", () => {
  test("every covered code point maps to a glyph the built face assigned", () => {
    expect(glyphs.size).toBe(codePoints.length);
    for (const code of codePoints) expect(glyphs.get(code)).toBeGreaterThan(0);
  });

  test("they are not the order the code points happened to arrive in", () => {
    const byOrder = codePoints.map((_code, index) => index + 1);
    expect(codePoints.map((code) => glyphs.get(code))).not.toEqual(byOrder);
  });

  test("the run written into the file is those ids, in the order the text sets them", async () => {
    const out = await render(FONT);
    const written = idsOf(out);
    const expected = [..."Declaration of interest"]
      .map((character) => (glyphs.get(character.codePointAt(0) ?? 0) ?? 0).toString(16).toUpperCase().padStart(4, "0"))
      .join("");
    expect(written).toBe(expected);
  });
});

describe("what the stream commits to is what measurement reserved", () => {
  // The width a viewer lays a `TJ` array out to: each glyph's `/W` advance, less every adjustment
  // in the array. Deriving it from the emitted stream is what stops layout and output drifting.
  function streamWidth(array: string, size: number, font: PdfEmbeddedFont): number {
    const advances = new Map([...font.metrics.advances].map(([code, advance]) => [font.glyphs.get(code) ?? 0, advance]));
    let units = 0;
    for (const token of array.slice(1, -1).trim().split(/\s+/)) {
      if (token.startsWith("<")) {
        const ids = token.slice(1, -1).match(/.{4}/g) ?? [];
        for (const id of ids) units += advances.get(Number.parseInt(id, 16)) ?? 0;
      } else units -= Number(token);
    }
    return (units * size) / 1000;
  }

  test("a run with kern pairs draws exactly as wide as embeddedWidth said", async () => {
    const out = await render(FONT);
    const array = /Td (\[[^\]]+\]) TJ/.exec(out)?.[1] ?? "";
    expect(array).toContain(" ");
    expect(streamWidth(array, 10, FONT)).toBeCloseTo(embeddedWidth("Declaration of interest", 10, FONT.metrics), 6);
  });

  test("and the kerning is really in there — the unkerned width is wider", () => {
    const unkerned = { ...FONT, metrics: { ...FONT.metrics, kerning: new Map() } };
    const run = "Declaration of interest AV";
    expect(embeddedWidth(run, 10, FONT.metrics)).toBeLessThan(embeddedWidth(run, 10, unkerned.metrics));
  });

  test("a face with no pair table emits one group, and still agrees with measurement", () => {
    const unkerned = { ...FONT, metrics: { ...FONT.metrics, kerning: new Map() } };
    const array = kernedArray("AV", unkerned);
    expect(array).not.toContain(" ");
    expect(streamWidth(array, 10, unkerned)).toBeCloseTo(embeddedWidth("AV", 10, unkerned.metrics), 6);
  });
});

describe("breakWord reaches an embedded face too", () => {
  const LONG = "Declaration";
  const NARROW = 30;

  test("an over-long word overflows by default, as it does in the base-14 faces", () => {
    const lines = Text({ children: LONG, font: FONT }).fragments({ x: 0, width: NARROW, height: 700 });
    expect(lines).toHaveLength(1);
  });

  test("and is cut where the caller asks, which the embedded path used to ignore", () => {
    const lines = Text({ children: LONG, font: FONT, breakWord: true }).fragments({ x: 0, width: NARROW, height: 700 });
    expect(lines.length).toBeGreaterThan(1);
  });

  test("the cut pieces still rejoin to the whole word", async () => {
    const doc: PdfDocument = { title: "D", content: [Stack({ children: [Text({ children: LONG, font: FONT, breakWord: true })] })] };
    const rendered = await createPdfRenderer({ compress: false, fonts: [FONT] }).render(doc);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const out = decoder.decode(rendered.data);
    const ids = idsOf(out);
    const expected = [...LONG]
      .map((character) => (glyphs.get(character.codePointAt(0) ?? 0) ?? 0).toString(16).toUpperCase().padStart(4, "0"))
      .join("");
    expect(ids).toBe(expected);
  });
});
