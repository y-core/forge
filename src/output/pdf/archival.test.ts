import { describe, expect, test } from "bun:test";

import { Text } from "./components";
import { parsePdfText } from "./conform/parse.fixture";
import { Path } from "./graphics";
import { createPdfPen } from "./path";
import { createPdfRenderer } from "./renderer";
import type { PdfDocument, PdfEmbeddedFont, PdfRendererOptions } from "./types";

const decoder = new TextDecoder("latin1");

const FACE: PdfEmbeddedFont = {
  name: "body",
  postScriptName: "Body-Regular",
  sfnt: new Uint8Array([0, 1, 0, 0]),
  glyphs: new Map(Array.from({ length: 96 }, (_glyph, at) => [at + 32, at + 3] as const)),
  metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, bbox: [0, 0, 1000, 1000], advances: new Map() },
};

const ARCHIVAL: PdfRendererOptions = {
  archival: "a-2b",
  metadata: "standard",
  compress: false,
  fonts: [FACE],
  defaultFont: { regular: "body", bold: "body" },
  info: { title: "Declaration", created: new Date(Date.UTC(2026, 8, 21)) },
};

const DOC: PdfDocument = { title: "Declaration", content: [Text({ children: "A line of the declaration." })] };

async function textOf(options: PdfRendererOptions, doc: PdfDocument = DOC): Promise<string> {
  const rendered = await createPdfRenderer(options).render(doc);
  if (!rendered.ok) throw new Error(rendered.error.message);
  return decoder.decode(rendered.data);
}

describe("an archival render declares the one output intent PDF/A requires", () => {
  test("names the intent, its condition, and the profile explaining it", async () => {
    const text = await textOf(ARCHIVAL);
    expect(text).toContain("/Type /OutputIntent /S /GTS_PDFA1");
    expect(text).toContain("/OutputConditionIdentifier (sRGB IEC61966-2.1)");
    expect(text).toContain("/DestOutputProfile");
    expect(text).toContain("/N 3");
  });

  test("opens PDF 1.7, and carries exactly one intent", async () => {
    const text = await textOf(ARCHIVAL);
    expect(text.startsWith("%PDF-1.7\n")).toBe(true);
    expect([...text.matchAll(/\/Type \/OutputIntent/g)]).toHaveLength(1);
  });

  // The same posture as `tagged`: a document asking for nothing pays for nothing.
  test("a render asking for no level carries neither the intent nor the profile", async () => {
    const text = await textOf({ ...ARCHIVAL, archival: undefined });
    expect(text).not.toContain("OutputIntent");
    expect(text).not.toContain("acsp");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  });

  test("stays reproducible: two renders of one document are byte-identical", async () => {
    const rendered = await Promise.all([textOf(ARCHIVAL), textOf(ARCHIVAL)]);
    expect(rendered[0]).toBe(rendered[1]);
  });
});

describe("a page names the space it composites in, where it composites at all", () => {
  const pen = createPdfPen().move(0, 0).line(40, 0).line(40, 20).close();
  const shaded: PdfDocument = {
    title: "Declaration",
    content: [
      Path({
        commands: pen.commands(),
        height: 20,
        fill: {
          kind: "axial",
          from: [0, 0],
          to: [40, 0],
          stops: [
            { at: 0, ink: [1, 0, 0] },
            { at: 1, ink: [0, 0, 1] },
          ],
        },
      }),
    ],
  };

  test("declares the group on a page carrying a shading", async () => {
    expect(await textOf(ARCHIVAL, shaded)).toContain("/Group << /S /Transparency /CS /DeviceRGB >>");
  });

  test("leaves a page drawing nothing translucent as it was", async () => {
    expect(await textOf(ARCHIVAL)).not.toContain("/Group");
  });

  test("writes no group at all where no level is asked for", async () => {
    expect(await textOf({ ...ARCHIVAL, archival: undefined }, shaded)).not.toContain("/Group");
  });
});

describe("a render that cannot produce the level is refused before a byte is written", () => {
  async function refusal(options: PdfRendererOptions): Promise<string> {
    const rendered = await createPdfRenderer(options).render(DOC);
    expect(rendered.ok).toBe(false);
    return rendered.ok ? "" : rendered.error.message;
  }

  test("answers on the pdfa kind, naming the prohibition and the remedy", async () => {
    const rendered = await createPdfRenderer({ ...ARCHIVAL, metadata: "none" }).render(DOC);
    expect(rendered.ok).toBe(false);
    if (rendered.ok) return;
    expect(rendered.error.kind).toBe("pdfa");
    expect(rendered.error.message).toContain("standard");
  });

  test("refuses a missing creation date rather than stamping the moment it ran", async () => {
    expect(await refusal({ ...ARCHIVAL, info: { title: "Declaration" } })).toContain("info.created");
  });

  test("refuses the tagged level with tagging off", async () => {
    expect(await refusal({ ...ARCHIVAL, archival: "a-2a", tagged: false })).toContain("tagged: true");
  });

  test("refuses a run left in the base-14 pair", async () => {
    expect(await refusal({ ...ARCHIVAL, fonts: undefined, defaultFont: undefined })).toContain("base-14");
  });

  test("renders where every prohibition is satisfied, so the refusals are not a wall", async () => {
    const rendered = await createPdfRenderer(ARCHIVAL).render(DOC);
    expect(rendered.ok).toBe(true);
  });
});

describe("the packet and the dictionary say the same thing", () => {
  test("declares the part and the conformance in XMP, from the info the dictionary reads", async () => {
    const text = await textOf({ ...ARCHIVAL, archival: "a-2u" });
    expect(text).toContain("<pdfaid:part>2</pdfaid:part>");
    expect(text).toContain("<pdfaid:conformance>U</pdfaid:conformance>");
    expect(text).toContain("<xmp:CreateDate>2026-09-21T00:00:00Z</xmp:CreateDate>");
    expect(await parsePdfText(new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>)).toContain("/CreationDate (D:20260921000000Z)");
  });
});
