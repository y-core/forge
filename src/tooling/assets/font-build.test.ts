import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildFont, buildFontSubsets, extractFontMetrics, postScriptName, subsetFont } from "./font-build";

const SOURCE = "node_modules/@expo-google-fonts/oswald/400Regular/Oswald_400Regular.ttf";
const WASM = "node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm";

const sfnt = new Uint8Array(await Bun.file(SOURCE).arrayBuffer());
const points = (run: string): number[] => [...new Set([...run].map((character) => character.codePointAt(0) ?? 0))];

describe("subsetFont", () => {
  test("keeps an sfnt an sfnt, and makes it very much smaller", async () => {
    const subset = await subsetFont({ sfnt, codePoints: points("Declaration of interest"), wasm: WASM });
    expect([...subset.slice(0, 4)]).toEqual([0, 1, 0, 0]);
    expect(subset.length).toBeLessThan(sfnt.length / 4);
  });

  // The pipeline names no path, so an omitted `wasm` is the production call rather than a convenience.
  test("omitting the wasm path subsets through the module harfbuzzjs ships", async () => {
    const named = await subsetFont({ sfnt, codePoints: points("abc"), wasm: WASM });
    const resolved = await subsetFont({ sfnt, codePoints: points("abc") });
    expect([...resolved]).toEqual([...named]);
  });

  test("a wider corpus produces a larger subset, so the request is what decides the size", async () => {
    const narrow = await subsetFont({ sfnt, codePoints: points("abc"), wasm: WASM });
    const wide = await subsetFont({ sfnt, codePoints: points("abcdefghijklmnopqrstuvwxyz0123456789"), wasm: WASM });
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  test("the subset still resolves the glyphs it was asked for", async () => {
    const subset = await subsetFont({ sfnt, codePoints: points("Du Toit"), wasm: WASM });
    const metrics = await extractFontMetrics(subset, points("Du Toit"));
    for (const code of points("Du Toit")) expect(metrics.advances[String(code)]).toBeGreaterThan(0);
  });
});

describe("extractFontMetrics", () => {
  test("reads the em square and the vertical metrics from the face", async () => {
    const metrics = await extractFontMetrics(sfnt, points("A"));
    expect(metrics.unitsPerEm).toBe(1000);
    expect(metrics.ascent).toBeGreaterThan(0);
    expect(metrics.descent).toBeLessThan(0);
  });

  // The box is read out of `head` because harfbuzzjs exposes no accessor for it, so the exact four
  // numbers are the claim: a plausible-looking constant would pass every inequality and fail this.
  test("reads the face's own bounding box out of its head table", async () => {
    expect((await extractFontMetrics(sfnt, points("A"))).bbox).toEqual([-197, -287, 1223, 1297]);
  });

  test("carries the same box through a subset, which HarfBuzz does not recompute", async () => {
    const subset = await subsetFont({ sfnt, codePoints: points("."), wasm: WASM });
    expect((await extractFontMetrics(subset, points("."))).bbox).toEqual([-197, -287, 1223, 1297]);
  });

  test("scales every advance to 1000 units of the em, whatever the face measures in", async () => {
    const metrics = await extractFontMetrics(sfnt, points("AB"));
    for (const advance of Object.values(metrics.advances)) {
      expect(advance).toBeGreaterThan(0);
      expect(advance).toBeLessThan(1000);
    }
  });

  test("skips a code point the face has no glyph for, rather than recording a zero advance", async () => {
    const metrics = await extractFontMetrics(sfnt, [0x4fa1]);
    expect(metrics.advances["20385"]).toBeUndefined();
  });
});

const kerned = await extractFontMetrics(sfnt, points("AVWTavo"));

describe("GPOS pair kerning", () => {
  const metrics = kerned;

  test("pulls the pairs the face actually kerns, and leaves the rest out", () => {
    expect(Object.keys(metrics.kerning).length).toBeGreaterThan(0);
    expect(metrics.kerning["65,86"]).toBeLessThan(0);
    expect(metrics.kerning["65,65"]).toBeUndefined();
  });

  test("is measured against the shaper, so a pair's adjustment is what HarfBuzz would apply", () => {
    // A/V is the canonical kern pair; the sign says the pair closes up rather than opening out.
    expect(metrics.kerning["65,86"]).toBeLessThan(-10);
    expect(metrics.kerning["86,65"]).toBeLessThan(-10);
  });
});

describe("buildFont", () => {
  test("answers a subset face and the metrics that describe it, in one pass", async () => {
    const built = await buildFont({ sfnt, codePoints: points("Declaration"), wasm: WASM });
    expect(built.sfnt.length).toBeLessThan(sfnt.length);
    expect(built.metrics.unitsPerEm).toBe(1000);
    expect(Object.keys(built.metrics.advances).length).toBeGreaterThan(0);
  });
});

describe("the subsetter is cached per wasm path, which is the key it takes", () => {
  test("a second path instantiates its own module rather than reusing the first", async () => {
    // A byte-identical copy at a second path: same behaviour, different module, so the only way both
    // subsets can succeed is if the path reached the cache lookup.
    const copy = join(tmpdir(), `harfbuzz-subset-${Date.now()}.wasm`);
    writeFileSync(copy, new Uint8Array(await Bun.file(WASM).arrayBuffer()));
    try {
      const first = await subsetFont({ sfnt, codePoints: points("abc"), wasm: WASM });
      const second = await subsetFont({ sfnt, codePoints: points("abc"), wasm: copy });
      expect([...second]).toEqual([...first]);
      const missing = subsetFont({ sfnt, codePoints: points("abc"), wasm: join(tmpdir(), "absent.wasm") });
      await expect(missing).rejects.toThrow();
    } finally {
      rmSync(copy, { force: true });
    }
  });

  test("a path that is not a wasm module fails rather than falling back to a cached one", async () => {
    const bogus = join(tmpdir(), `not-wasm-${Date.now()}.wasm`);
    writeFileSync(bogus, "not a module");
    try {
      await expect(subsetFont({ sfnt, codePoints: points("abc"), wasm: bogus })).rejects.toThrow();
    } finally {
      rmSync(bogus, { force: true });
    }
  });
});

describe("buildFontSubsets is the stage, not a library call", () => {
  test("writes the subset face under publicDir and answers a pack describing it", async () => {
    const dir = join(tmpdir(), `forge-subset-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const packs = await buildFontSubsets(
        [{ family: "Oswald", from: SOURCE, to: "fonts/oswald-400.ttf", covering: "Declaration of interest", weight: 400 }],
        dir,
        WASM,
      );
      const written = join(dir, "fonts", "oswald-400.ttf");
      expect(existsSync(written)).toBe(true);
      expect(readFileSync(written).length).toBeLessThan(sfnt.length / 4);
      expect(packs).toHaveLength(1);
      expect(packs[0]?.faces[0]).toMatchObject({
        postScriptName: "Oswald-Regular",
        weight: 400,
        style: "normal",
        stretch: 100,
        sfnt: "fonts/oswald-400.ttf",
      });
      expect(Object.keys(packs[0]?.faces[0]?.metrics.advances ?? {}).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("groups every face of one family into a single pack", async () => {
    const dir = join(tmpdir(), `forge-subset-family-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const packs = await buildFontSubsets(
        [
          { family: "Oswald", from: SOURCE, to: "fonts/oswald-400.ttf", covering: "abc", weight: 400 },
          { family: "Oswald", from: SOURCE, to: "fonts/oswald-700.ttf", covering: "abc", weight: 700 },
        ],
        dir,
        WASM,
      );
      expect(packs).toHaveLength(1);
      expect(packs[0]?.faces.map((face) => face.weight)).toEqual([400, 700]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses a destination that escapes the asset root", async () => {
    const dir = join(tmpdir(), `forge-subset-escape-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const escaping = buildFontSubsets([{ family: "Oswald", from: SOURCE, to: "../escape.ttf", covering: "a" }], dir, WASM);
      await expect(escaping).rejects.toThrow(/escapes the asset root/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// A minimal sfnt carrying one `name` record and nothing else — enough for the reader to walk, and
// the only way to exercise the platform-1 encoding, which no font in `node_modules` here ships.
function sfntNaming(platform: number, name: string): Uint8Array {
  const text = platform === 3 ? [...name].flatMap((character) => [0, character.charCodeAt(0)]) : [...name].map((c) => c.charCodeAt(0));
  const table = new Uint8Array(18 + text.length);
  const record = new DataView(table.buffer);
  record.setUint16(2, 1);
  record.setUint16(4, 18);
  record.setUint16(6, platform);
  record.setUint16(8, platform === 3 ? 1 : 0);
  record.setUint16(12, 6);
  record.setUint16(14, text.length);
  table.set(text, 18);

  const font = new Uint8Array(28 + table.length);
  const header = new DataView(font.buffer);
  header.setUint32(0, 0x00010000);
  header.setUint16(4, 1);
  font.set(
    [..."name"].map((c) => c.charCodeAt(0)),
    12,
  );
  header.setUint32(20, 28);
  header.setUint32(24, table.length);
  font.set(table, 28);
  return font;
}

describe("postScriptName", () => {
  test("decodes a Windows record as the UTF-16BE the platform writes", () => {
    expect(postScriptName(sfntNaming(3, "Inter-Regular"))).toBe("Inter-Regular");
  });

  test("decodes a Macintosh record as the single byte per character that platform writes", () => {
    expect(postScriptName(sfntNaming(1, "Inter-Regular"))).toBe("Inter-Regular");
  });

  test("reads the name a real face gives itself, which is what a font descriptor is written as", () => {
    expect(postScriptName(sfnt)).toBe("Oswald-Regular");
  });

  test("refuses a face that names itself nothing rather than inventing one", () => {
    expect(() => postScriptName(new Uint8Array(12))).toThrow(/names itself nothing/);
  });
});
