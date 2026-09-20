import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Blob as HbBlob, Buffer as HbBuffer, Face, Font, shape } from "harfbuzzjs";

import { safeJoin } from "./paths";
import type { FontBuild, FontMetricsData, FontPackData, FontSubset, SubsetRequest } from "./types";

// The subset API is HarfBuzz's C surface, which harfbuzzjs does not wrap, so the module is
// instantiated directly. Build-time only: no Worker ever loads this, and no runtime dependency.
interface SubsetExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_blob_destroy(blob: number): void;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, code: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_pin_all_axes_to_default(input: number, face: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

const MEMORY_MODE_WRITABLE = 2;

/** Where the subsetter's module ships, which is the path the pipeline uses unless a caller names another. @public */
export const HARFBUZZ_SUBSET_WASM = "node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm";

const subsetters = new Map<string, Promise<SubsetExports>>();

function exports(wasmPath: string): Promise<SubsetExports> {
  const built = subsetters.get(wasmPath);
  if (built !== undefined) return built;
  const instantiated = Bun.file(wasmPath)
    .arrayBuffer()
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then((module) => module.instance.exports as unknown as SubsetExports);
  subsetters.set(wasmPath, instantiated);
  return instantiated;
}

/** Reduces a font to the code points a document actually sets, keeping every table consistent. @public */
export async function subsetFont(request: SubsetRequest): Promise<Uint8Array> {
  const hb = await exports(request.wasm);
  const heap = (): Uint8Array => new Uint8Array(hb.memory.buffer);
  const source = hb.malloc(request.sfnt.length);
  heap().set(request.sfnt, source);
  const blob = hb.hb_blob_create(source, request.sfnt.length, MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  let input = 0;
  let subset = 0;
  try {
    input = hb.hb_subset_input_create_or_fail();
    if (input === 0) throw new Error("subsetFont: harfbuzz refused to create a subset input");
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const code of request.codePoints) hb.hb_set_add(unicodes, code);
    // A static instance has no axes to pin, and pinning a variable font's is what makes the subset a
    // single face rather than a design space the writer would have to embed whole.
    hb.hb_subset_input_pin_all_axes_to_default(input, face);
    subset = hb.hb_subset_or_fail(face, input);
    if (subset === 0) throw new Error("subsetFont: harfbuzz refused to subset this face");
    const out = hb.hb_face_reference_blob(subset);
    const bytes = heap().slice(hb.hb_blob_get_data(out, 0), hb.hb_blob_get_data(out, 0) + hb.hb_blob_get_length(out));
    hb.hb_blob_destroy(out);
    return bytes;
  } finally {
    // Every allocation is freed on the way out, whichever way out it is — a refusal above leaves the
    // same five handles behind that success does.
    if (subset !== 0) hb.hb_face_destroy(subset);
    if (input !== 0) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.hb_blob_destroy(blob);
    hb.free(source);
  }
}

// harfbuzzjs exposes ascender, descender and line gap and no bounding box at all, so the one table
// carrying it is read directly: `head` holds xMin, yMin, xMax and yMax as int16s from byte 36.
function boundingBox(face: Face): [number, number, number, number] {
  const head = face.referenceTable("head") ?? new Uint8Array();
  const view = new DataView(head.buffer as ArrayBuffer, head.byteOffset, head.byteLength);
  const at = (offset: number): number => (head.byteLength >= offset + 2 ? view.getInt16(offset) : 0);
  return [at(36), at(38), at(40), at(42)];
}

// harfbuzzjs exposes no name table either, so `name` is walked directly: ID 6 is the PostScript
// name, which is what a font descriptor and a `/BaseFont` are written as.
/** The face's own PostScript name, read from `name` ID 6 rather than spelled a second time. @public */
export function postScriptName(sfnt: Uint8Array): string {
  const view = new DataView(sfnt.buffer as ArrayBuffer, sfnt.byteOffset, sfnt.byteLength);
  const tables = view.getUint16(4);
  for (let at = 0; at < tables; at += 1) {
    const entry = 12 + at * 16;
    if (String.fromCharCode(...sfnt.slice(entry, entry + 4)) !== "name") continue;
    const table = view.getUint32(entry + 8);
    const count = view.getUint16(table + 2);
    const strings = table + view.getUint16(table + 4);
    for (let record = 0; record < count; record += 1) {
      const at6 = table + 6 + record * 12;
      if (view.getUint16(at6 + 6) !== 6) continue;
      const [length, offset] = [view.getUint16(at6 + 8), view.getUint16(at6 + 10)];
      const bytes = sfnt.slice(strings + offset, strings + offset + length);
      // Platform 3 writes UTF-16BE, platform 1 a single byte per character; both spell ASCII here.
      const text = view.getUint16(at6) === 3 ? new TextDecoder("utf-16be").decode(bytes) : String.fromCharCode(...bytes);
      if (text !== "") return text;
    }
  }
  throw new Error("postScriptName: name ID 6 absent — this face names itself nothing");
}

/** The advances and vertical metrics a face sets at, read once so the Worker never parses a font. @public */
export function extractFontMetrics(sfnt: Uint8Array, codePoints: Iterable<number>): FontMetricsData {
  const face = new Face(new HbBlob(sfnt), 0);
  const font = new Font(face);
  const extents = font.hExtents();
  const advances: Record<string, number> = {};
  // The subset reassigns glyph ids, so the mapping is read off the built face rather than guessed —
  // `Identity-H` addresses these numbers directly, and a wrong one sets a different glyph.
  const glyphs: Record<string, number> = {};
  for (const code of codePoints) {
    const glyph = font.nominalGlyph(code);
    if (glyph === undefined) continue;
    advances[String(code)] = (font.glyphHAdvance(glyph) * 1000) / face.upem;
    glyphs[String(code)] = glyph;
  }
  return {
    unitsPerEm: face.upem,
    ascent: extents.ascender,
    descent: extents.descender,
    bbox: boundingBox(face),
    advances,
    glyphs,
    kerning: extractKerning(font, codePoints),
  };
}

// Shaping the pair is what reads GPOS, so the adjustment is whatever HarfBuzz would apply — rather
// than a second parser of the table that could disagree with the one that laid the text out.
function extractKerning(font: Font, codePoints: Iterable<number>): Record<string, number> {
  const points = [...codePoints];
  const pairs: Record<string, number> = {};
  const single = new Map<number, number>();
  for (const code of points) single.set(code, advanceOf(font, String.fromCodePoint(code)));
  for (const left of points) {
    for (const right of points) {
      const together = advanceOf(font, String.fromCodePoint(left) + String.fromCodePoint(right));
      const apart = (single.get(left) ?? 0) + (single.get(right) ?? 0);
      const adjustment = together - apart;
      if (adjustment !== 0) pairs[`${left},${right}`] = (adjustment * 1000) / font.face.upem;
    }
  }
  return pairs;
}

function advanceOf(font: Font, run: string): number {
  const buffer = new HbBuffer();
  buffer.addText(run);
  buffer.guessSegmentProperties();
  shape(font, buffer);
  return buffer.getGlyphPositions().reduce((sum, glyph) => sum + glyph.xAdvance, 0);
}

/** Builds the artifacts `output/pdf/fonts` ships: a subset face and the metrics beside it. @public */
export async function buildFont(build: FontBuild): Promise<{ sfnt: Uint8Array; metrics: FontMetricsData }> {
  const sfnt = await subsetFont({ sfnt: build.sfnt, codePoints: build.codePoints, wasm: build.wasm });
  return { sfnt, metrics: extractFontMetrics(sfnt, build.codePoints) };
}

// Kept separate from the write below because the faces module is emitted from a config and
// `node_modules` alone — `gen types` needs the bytes without a `public/` tree to read them back out.
/** Subsets every configured face in memory, returning the pack the engine reads and the bytes it names. @public */
export async function buildFontPacks(
  subsets: readonly FontSubset[],
  wasm: string,
): Promise<{ packs: FontPackData[]; sfnt: ReadonlyMap<string, Uint8Array> }> {
  const byFamily = new Map<string, FontPackData>();
  const bytes = new Map<string, Uint8Array>();
  for (const subset of subsets) {
    const source = new Uint8Array(await Bun.file(subset.from).arrayBuffer());
    const codePoints = [...new Set([...subset.covering].map((character) => character.codePointAt(0) ?? 0))];
    const built = await buildFont({ sfnt: source, codePoints, wasm });
    bytes.set(subset.to, built.sfnt);
    const pack = byFamily.get(subset.family) ?? { family: subset.family, faces: [] };
    pack.faces.push({
      postScriptName: postScriptName(built.sfnt),
      weight: subset.weight ?? 400,
      style: subset.style ?? "normal",
      stretch: subset.stretch ?? 100,
      sfnt: subset.to,
      metrics: built.metrics,
    });
    byFamily.set(subset.family, pack);
  }
  return { packs: [...byFamily.values()], sfnt: bytes };
}

/** Subsets every configured face and writes it beside the pack the engine reads. @public */
export async function buildFontSubsets(subsets: readonly FontSubset[], publicDir: string, wasm: string): Promise<FontPackData[]> {
  const { packs, sfnt } = await buildFontPacks(subsets, wasm);
  for (const [to, bytes] of sfnt) {
    const dest = safeJoin(publicDir, to);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
  return packs;
}
