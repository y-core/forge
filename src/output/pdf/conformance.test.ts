import { describe, expect, test } from "bun:test";

import { Text } from "./components";
import { conformanceViolations } from "./conformance";
import { Image } from "./graphics";
import { createPdfImage } from "./image";
import { jpegBytes } from "./image.fixture";
import { Link } from "./link";
import { paginate } from "./paginate";
import type { PdfArchival, PdfConformanceRule, PdfContent, PdfDocument, PdfEmbeddedFont, PdfPage, PdfRendererOptions } from "./types";
import { resolveTypesetting } from "./typesetting";

const FACE: PdfEmbeddedFont = {
  name: "body",
  postScriptName: "Body-Regular",
  sfnt: new Uint8Array([0, 1, 0, 0]),
  glyphs: new Map([...Array.from({ length: 96 }, (_glyph, at) => [at + 32, at + 3] as const)]),
  metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, bbox: [0, 0, 1000, 1000], advances: new Map() },
};

// Every prohibition off, so a rule that fires is the one the case turned on and never a leftover.
const CONFORMANT: PdfRendererOptions = {
  metadata: "standard",
  tagged: true,
  fonts: [FACE],
  defaultFont: { regular: "body", bold: "body" },
  info: { title: "Declaration", created: new Date(Date.UTC(2026, 8, 21)) },
};

// Laid out through the same typesetting the renderer resolves, because whether a run is left in the
// base-14 pair is decided there — a default face the layout never saw makes the table read wrong.
function pagesFor(content: PdfContent, options: PdfRendererOptions): readonly PdfPage[] {
  const doc: PdfDocument = { title: "Declaration", content };
  return paginate(doc, {}, undefined, {}, resolveTypesetting(options.fonts, options.defaultFont));
}

function rules(content: PdfContent, options: PdfRendererOptions = CONFORMANT, level: PdfArchival = "a-2b"): PdfConformanceRule[] {
  return conformanceViolations(pagesFor(content, options), options, level).map((found) => found.rule);
}

const LINE: PdfContent = [Text({ children: "A line of the declaration." })];

describe("the one table the audit reports from and the renderer refuses on", () => {
  test("finds nothing against a document that can declare the level", () => {
    expect(rules(LINE)).toEqual([]);
  });

  test("refuses metadata that writes no packet, because PDF/A is declared in one", () => {
    expect(rules(LINE, { ...CONFORMANT, metadata: "none" })).toContain("metadata");
  });

  test("refuses a document with no creation date, which this engine never invents", () => {
    expect(rules(LINE, { ...CONFORMANT, info: { title: "Declaration" } })).toContain("date");
  });

  test("refuses the tagged level where tagging is off, and admits the other two", () => {
    expect(rules(LINE, { ...CONFORMANT, tagged: false }, "a-2a")).toContain("tagged");
    for (const level of ["a-2b", "a-2u"] as const) expect(rules(LINE, { ...CONFORMANT, tagged: false }, level)).not.toContain("tagged");
  });

  test("refuses a face supplied with no bytes, which embeds nothing", () => {
    expect(rules(LINE, { ...CONFORMANT, fonts: [{ ...FACE, sfnt: new Uint8Array() }] })).toContain("font-supplied");
  });

  test("refuses a run left in the base-14 pair, whose glyphs the file does not carry", () => {
    expect(rules(LINE, { ...CONFORMANT, fonts: undefined, defaultFont: undefined })).toContain("font-embedded");
  });

  test("refuses a link scheme an archive cannot follow on its own", () => {
    const mail = [Link({ to: { uri: "mailto:records@example.org" }, children: [Text({ children: "Write to us" })] })];
    expect(rules(mail)).toContain("link-scheme");
    const web = [Link({ to: { uri: "https://example.org/terms" }, children: [Text({ children: "The terms" })] })];
    expect(rules(web)).not.toContain("link-scheme");
  });
});

// Reachable and easy to miss: `image.ts` maps any four-component JPEG to `/DeviceCMYK`, and the
// intent this wave embeds is sRGB — so the file would declare two different colour meanings.
describe("a colour space the sRGB output intent cannot explain", () => {
  test("refuses a CMYK image and names re-saving it as the remedy", async () => {
    const cmyk = await createPdfImage(jpegBytes(8, 8, 4));
    expect(cmyk.ok).toBe(true);
    if (!cmyk.ok) return;
    const found = conformanceViolations(pagesFor(Image({ image: cmyk.data, width: 40 }), CONFORMANT), CONFORMANT, "a-2b");
    expect(found.map((one) => one.rule)).toContain("colour-space");
    expect(found.find((one) => one.rule === "colour-space")?.message).toContain("re-save");
  });

  test("admits the RGB image the same pipeline produces from three components", async () => {
    const rgb = await createPdfImage(jpegBytes(8, 8, 3));
    expect(rgb.ok).toBe(true);
    if (!rgb.ok) return;
    expect(rules(Image({ image: rgb.data, width: 40 }))).not.toContain("colour-space");
  });
});
