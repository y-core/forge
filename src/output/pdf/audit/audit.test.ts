import { describe, expect, test } from "bun:test";

import { createPdfRenderer } from "../renderer";
import type { PdfArtwork, PdfDocument, PdfEmbeddedFont, PdfRendererOptions } from "../types";
import { auditPdf } from "./audit";
import type { PdfAuditRule } from "./types";

const DOC: PdfDocument = { title: "Declaration of interest", content: [] };

const FACE: PdfEmbeddedFont = {
  name: "body",
  postScriptName: "Body",
  sfnt: new Uint8Array(),
  glyphs: new Map(),
  metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, bbox: [0, 0, 1000, 1000], advances: new Map() },
};

const CONFORMANT: PdfRendererOptions = { tagged: true, metadata: "standard", info: { title: "Declaration of interest" }, fonts: [FACE] };

function rules(document: PdfDocument, options: PdfRendererOptions): PdfAuditRule[] {
  return auditPdf(document, options).map((finding) => finding.rule);
}

describe("a render aiming at conformance", () => {
  test("passes with nothing to report when every declaration is in place", () => {
    expect(auditPdf(DOC, CONFORMANT)).toEqual([]);
  });

  test("reports an untagged document, which is the one that has no reading order at all", () => {
    expect(rules(DOC, { ...CONFORMANT, tagged: false })).toContain("tagged");
  });

  test("reports a blank language, and says nothing about one left unset", () => {
    expect(rules(DOC, { ...CONFORMANT, lang: "  " })).toContain("lang");
    expect(rules(DOC, { ...CONFORMANT, lang: "en-ZA" })).toEqual([]);
    expect(rules(DOC, CONFORMANT)).toEqual([]);
  });
});

describe("the title a checker reads", () => {
  test("reports metadata that writes no dictionary, and asks about no title until it does", () => {
    expect(rules(DOC, { ...CONFORMANT, metadata: "none" })).toEqual(["metadata"]);
  });

  test("reports an empty title, since a viewer told to show one then has nothing", () => {
    expect(rules(DOC, { ...CONFORMANT, info: { title: " " } })).toContain("title");
  });

  test("reports a metadata title that disagrees with the one the document prints", () => {
    const findings = auditPdf(DOC, { ...CONFORMANT, info: { title: "Something else" } });
    expect(findings.map((finding) => finding.rule)).toContain("title");
    expect(findings[0]?.message).toContain("Declaration of interest");
  });
});

describe("what a drawing and a face declare", () => {
  const mark: PdfArtwork = { width: 1, height: 1, paths: [] };
  const letterhead = { name: "Meridian", tagline: "Practice", email: "a@b.example", phone: "+27 21 555 0143" };

  test("reports a letterhead mark with no alt, which draws as decoration a reader passes over", () => {
    expect(rules({ ...DOC, letterhead: { ...letterhead, mark } }, CONFORMANT)).toContain("alt");
  });

  test("says nothing about a mark that carries one, or about a letterhead with no mark", () => {
    expect(rules({ ...DOC, letterhead: { ...letterhead, mark: { ...mark, alt: "The Meridian mark" } } }, CONFORMANT)).toEqual([]);
    expect(rules({ ...DOC, letterhead }, CONFORMANT)).toEqual([]);
  });

  test("reports a tagged document with no embedded face, since the file then carries no glyphs", () => {
    expect(rules(DOC, { ...CONFORMANT, fonts: [] })).toContain("fonts");
  });

  test("says nothing about the base-14 faces where the document is not tagged", () => {
    expect(rules(DOC, { ...CONFORMANT, tagged: false, fonts: [] })).toEqual(["tagged"]);
  });

  test("reports the base-14 combination only where the caller asked for it, not where a default reached it", () => {
    expect(rules(DOC, { ...CONFORMANT, tagged: true, fonts: [] })).toContain("fonts");
    expect(rules(DOC, { ...CONFORMANT, tagged: undefined, fonts: [] })).not.toContain("fonts");
  });
});

// The defect this guards is a silent disagreement: the audit reporting a structure tree the render
// did not write, or passing a render that wrote none. One options object, both answers.
describe("the audit and the render answer the same question the same way", () => {
  const CASES: readonly PdfRendererOptions[] = [{}, { fonts: [FACE] }, { tagged: false, fonts: [FACE] }, { tagged: true }, { fonts: [] }];

  for (const [at, options] of CASES.entries()) {
    test(`agree on whether case ${at} is tagged`, async () => {
      const rendered = await createPdfRenderer({ ...options, compress: false }).render(DOC);
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) return;
      const written = new TextDecoder("latin1").decode(rendered.data).includes("/StructTreeRoot");
      expect(rules(DOC, options).includes("tagged")).toBe(!written);
    });
  }
});

describe("what the audit is", () => {
  test("reads the options a render is configured with, so it needs no rendered bytes at all", () => {
    expect(auditPdf(DOC).map((finding) => finding.rule)).toEqual(["tagged", "metadata"]);
  });

  test("says what to do as well as what is wrong, so a finding is actionable on its own", () => {
    expect(auditPdf(DOC).every((finding) => finding.message.length > finding.rule.length)).toBe(true);
  });
});
