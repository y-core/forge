import { describe, expect, test } from "bun:test";

import { Text } from "./components";
import { conformanceViolations } from "./conformance";
import { Image } from "./graphics";
import { createPdfImage } from "./image";
import { jpegBytes } from "./image.fixture";
import { Link } from "./link";
import { paginate } from "./paginate";
import { preparePdfRender } from "./prepare";
import type {
  PdfArchival,
  PdfAttachment,
  PdfConformanceRule,
  PdfConformanceViolation,
  PdfContent,
  PdfDocument,
  PdfEmbeddedFont,
  PdfPage,
  PdfRendererOptions,
} from "./types";
import { resolveTypesetting } from "./typesetting";

const FACE: PdfEmbeddedFont = {
  name: "body",
  postScriptName: "Body-Regular",
  sfnt: new Uint8Array([0, 1, 0, 0]),
  glyphs: new Map([...Array.from({ length: 96 }, (_glyph, at) => [at + 32, at + 3] as const)]),
  metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, bbox: [0, 0, 1000, 1000], advances: new Map() },
};

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

  test("refuses part 3's tagged level where tagging is off, and admits its other two", () => {
    expect(rules(LINE, { ...CONFORMANT, tagged: false }, "a-3a")).toContain("tagged");
    for (const level of ["a-3b", "a-3u"] as const) expect(rules(LINE, { ...CONFORMANT, tagged: false }, level)).not.toContain("tagged");
  });

  test("names the untagged levels of the part asked for as the remedy, never another part's", () => {
    for (const [level, remedy, otherPart] of [
      ["a-2a", "a-2b or a-2u", "a-3"],
      ["a-3a", "a-3b or a-3u", "a-2"],
    ] as const) {
      const untagged = { ...CONFORMANT, tagged: false };
      const message = conformanceViolations(pagesFor(LINE, untagged), untagged, level).find((found) => found.rule === "tagged")?.message ?? "";
      expect(message).toContain(remedy);
      expect(message).not.toContain(otherPart);
    }
  });

  test("refuses a face supplied with no bytes, which embeds nothing", () => {
    expect(rules(LINE, { ...CONFORMANT, fonts: [{ ...FACE, sfnt: new Uint8Array() }] })).toContain("font-supplied");
  });

  test("refuses a run left in the base-14 pair, whose glyphs the file does not carry", () => {
    expect(rules(LINE, { ...CONFORMANT, fonts: undefined, defaultFont: undefined })).toContain("font-embedded");
  });

  test("refuses nothing but the base-14 run where a document supplies no fonts at all", () => {
    expect(rules(LINE, { ...CONFORMANT, fonts: undefined, defaultFont: undefined })).toEqual(["font-embedded"]);
  });

  test("refuses a link scheme an archive cannot follow on its own", () => {
    const mail = [Link({ to: { uri: "mailto:records@example.org" }, children: [Text({ children: "Write to us" })] })];
    expect(rules(mail)).toContain("link-scheme");
    const web = [Link({ to: { uri: "https://example.org/terms" }, children: [Text({ children: "The terms" })] })];
    expect(rules(web)).not.toContain("link-scheme");
  });
});

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

const INVOICE: PdfAttachment = {
  name: "invoice.xml",
  mime: "application/xml",
  bytes: new TextEncoder().encode("<invoice/>"),
  relationship: "Source",
  modified: new Date(Date.UTC(2026, 8, 21)),
};

function violationsWith(attachments: PdfAttachment[], level: PdfArchival = "a-3b"): readonly PdfConformanceViolation[] {
  const options: PdfRendererOptions = { ...CONFORMANT, attachments };
  return conformanceViolations(pagesFor(LINE, options), options, level);
}

function preparedWith(attachments: PdfAttachment[], archival: PdfArchival): ReturnType<typeof preparePdfRender> {
  return preparePdfRender({ title: "Declaration", content: LINE }, { ...CONFORMANT, archival, attachments });
}

describe("an attachment is held to what an archive needs to keep it", () => {
  test("admits a complete attachment at every part 3 level, in the table and in the render alike", () => {
    for (const level of ["a-3b", "a-3u", "a-3a"] as const) {
      expect(violationsWith([INVOICE], level)).toEqual([]);
      expect(preparedWith([INVOICE], level).ok).toBe(true);
    }
  });

  test("refuses an attachment at a part 2 level, in the table and in the render alike", () => {
    const found = violationsWith([INVOICE], "a-2u");
    expect(found.map((one) => one.rule)).toEqual(["attachment"]);
    expect(found[0]?.message).toContain("a-3u");
    const prepared = preparedWith([INVOICE], "a-2u");
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error).toEqual({ kind: "pdfa", message: found[0]?.message ?? "" });
  });

  test("names each part 2 level's own part 3 twin as the remedy", () => {
    for (const [level, twin] of [
      ["a-2b", "a-3b"],
      ["a-2u", "a-3u"],
      ["a-2a", "a-3a"],
    ] as const) {
      expect(violationsWith([INVOICE], level).find((one) => one.rule === "attachment")?.message).toContain(twin);
    }
  });

  test("reports a part 2 level once, however many files it is asked to carry", () => {
    expect(violationsWith([INVOICE, { ...INVOICE, name: "ledger.csv" }], "a-2b").map((one) => one.rule)).toEqual(["attachment"]);
  });
});
