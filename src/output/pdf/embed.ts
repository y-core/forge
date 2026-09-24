import { num, pdfName } from "./text";
import type { PdfEmbeddedFont, PdfFaceCoverage, PdfFaceRun } from "./types";
import type { PdfObjectManager } from "./writer/types";

// An `Identity-H` CID is two bytes, which is four hex digits.
const CID_DIGITS = 4;

function hex(value: number, digits = CID_DIGITS): string {
  return value.toString(16).toUpperCase().padStart(digits, "0");
}

/** A run split where the face covering it changes, so one missing glyph falls back for itself. @internal */
export function splitByFace(run: string, faces: readonly PdfFaceCoverage[]): PdfFaceRun[] {
  const out: PdfFaceRun[] = [];
  for (const character of run) {
    const code = character.codePointAt(0) ?? 0;
    const face = faces.find((one) => one.covers(code));
    const last = out.at(-1);
    // A run drags no neighbour onto another face: the split is at the code point that needs it, so a
    // document with one missing glyph keeps every other character on the face it was set in.
    if (last !== undefined && last.face === face?.name) last.run += character;
    else out.push({ face: face?.name, run: character });
  }
  return out;
}

/** A run as the glyph ids `Identity-H` addresses, which is what the content stream carries. @internal */
export function glyphString(run: string, glyphs: ReadonlyMap<number, number>): string {
  return [...run]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      const glyph = glyphs.get(code);
      // The renderer refuses an uncovered document before a byte is written, so reaching this is a
      // broken invariant — and notdef would print a box where a word should be.
      if (glyph === undefined) throw new Error(`glyphString: the face has no glyph for U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
      return hex(glyph);
    })
    .join("");
}

/** A run as a `TJ` array: glyph groups with the kern between them. @internal */
export function kernedArray(run: string, font: PdfEmbeddedFont): string {
  const kerning = font.metrics.kerning;
  if (kerning === undefined || kerning.size === 0) return `[<${glyphString(run, font.glyphs)}>]`;
  const parts: string[] = [];
  let group = "";
  let previous: number | undefined;
  for (const character of run) {
    const code = character.codePointAt(0) ?? 0;
    // A `TJ` number moves the pen back in thousandths of the em, so the sign is the negation of the
    // adjustment the pair table records — which is what makes the drawn run match the measured one.
    const adjustment = previous === undefined ? 0 : (kerning.get(`${previous},${code}`) ?? 0);
    if (adjustment !== 0) {
      parts.push(`<${group}>`, num(-adjustment));
      group = "";
    }
    group += glyphString(character, font.glyphs);
    previous = code;
  }
  parts.push(`<${group}>`);
  return `[${parts.join(" ")}]`;
}

// `Identity-H` maps a two-byte code straight to a glyph id, so the file needs a second map back to
// Unicode or the text is unsearchable and uncopyable — which for a legal document is a defect.
function toUnicodeCMap(glyphs: ReadonlyMap<number, number>): string {
  const pairs = [...glyphs].map(([code, glyph]) => `<${hex(glyph)}> <${hex(code)}>`);
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    ...chunked(pairs),
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

// A CMap may declare at most 100 mappings per block, which is the format's own limit.
function chunked(pairs: readonly string[]): string[] {
  const out: string[] = [];
  for (let at = 0; at < pairs.length; at += 100) {
    const block = pairs.slice(at, at + 100);
    out.push(`${block.length} beginbfchar`, ...block, "endbfchar");
  }
  return out;
}

function widthArray(font: PdfEmbeddedFont): string {
  const entries = [...font.glyphs].map(([code, glyph]) => [glyph, font.metrics.advances.get(code) ?? 0] as const).sort((a, b) => a[0] - b[0]);
  return entries.map(([glyph, advance]) => `${glyph} [${num(advance)}]`).join(" ");
}

/** Writes an embedded face as a `Type0` font into the number a page already names it by. @internal */
export function embedFont(manager: PdfObjectManager, font: PdfEmbeddedFont, into: number): void {
  const file = manager.allocate({
    head: `<< /Length ${font.sfnt.length} /Length1 ${font.sfnt.length} >>\nstream\n`,
    bytes: font.sfnt,
    tail: "\nendstream",
  });
  const scale = 1000 / font.metrics.unitsPerEm;
  const descriptor = manager.allocate(
    `<< /Type /FontDescriptor /FontName /${pdfName(font.postScriptName)} /Flags 4 ` +
      `/FontBBox [${font.metrics.bbox.map((edge) => num(edge * scale)).join(" ")}] /ItalicAngle 0 ` +
      `/Ascent ${num(font.metrics.ascent * scale)} /Descent ${num(font.metrics.descent * scale)} ` +
      `/CapHeight ${num(font.metrics.ascent * scale)} /StemV 80 /FontFile2 ${file} 0 R >>`,
  );
  const descendant = manager.allocate(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${pdfName(font.postScriptName)} ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${descriptor} 0 R /DW 1000 /W [${widthArray(font)}] /CIDToGIDMap /Identity >>`,
  );
  const cmap = new TextEncoder().encode(toUnicodeCMap(font.glyphs));
  const toUnicode = manager.allocate({ head: `<< /Length ${cmap.length} >>\nstream\n`, bytes: cmap, tail: "\nendstream" });
  manager.fill(
    into,
    `<< /Type /Font /Subtype /Type0 /BaseFont /${pdfName(font.postScriptName)} /Encoding /Identity-H ` +
      `/DescendantFonts [${descendant} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
  );
}
