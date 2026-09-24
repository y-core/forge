import { describe, expect, test } from "bun:test";

import { Box, Stack, Text } from "../components";
import { conformanceViolations } from "../conformance";
import { Path } from "../graphics";
import { DEFAULT_PDF_LANG, DEFAULT_PDF_MAX_PAGES } from "../limits";
import { Link } from "../link";
import { resolvePdfPage } from "../page";
import { paginateWithin } from "../paginate";
import { createPdfPen } from "../path";
import { createPdfRenderer } from "../renderer";
import { Table } from "../table";
import type { PdfArtwork, PdfConformanceRule, PdfDocument, PdfElement, PdfEmbeddedFont, PdfRendererOptions } from "../types";
import { resolveTypesetting } from "../typesetting";
import { auditPdf } from "./audit";
import type { PdfAuditRule } from "./types";

const DOC: PdfDocument = { title: "Declaration of interest", content: [] };

// Bytes rather than an empty array: a face supplying none embeds nothing, which is its own finding.
const FACE: PdfEmbeddedFont = {
  name: "body",
  postScriptName: "Body",
  sfnt: new Uint8Array([0, 1, 0, 0]),
  glyphs: new Map(),
  metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, bbox: [0, 0, 1000, 1000], advances: new Map() },
};

// `lang` is spelled out rather than left to the default: a document that names no language is a
// finding of its own, so a fixture omitting it would not be the conformant one it claims to be.
const CONFORMANT: PdfRendererOptions = {
  tagged: true,
  lang: "en",
  metadata: "standard",
  info: { title: "Declaration of interest" },
  fonts: [FACE],
  defaultFont: { regular: "body", bold: "body" },
};

const DOC_WITH_LINK: PdfDocument = {
  title: "Declaration of interest",
  content: [Link({ to: { uri: "https://example.org/terms" }, children: [Text({ children: "The terms" })] })],
};

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

  test("reports a blank language, and says nothing about one explicitly set", () => {
    expect(rules(DOC, { ...CONFORMANT, lang: "  " })).toContain("lang");
    expect(rules(DOC, { ...CONFORMANT, lang: "en-ZA" })).toEqual([]);
  });

  // The defect this closes: a French document that never mentions `lang` shipped declaring English,
  // and the audit — whose whole purpose is to catch that before the file leaves — said nothing.
  test("reports a language left unset, naming the default the file will otherwise declare", () => {
    const { lang: _unset, ...silent } = CONFORMANT;
    expect(rules(DOC, silent)).toEqual(["lang-default"]);
    expect(auditPdf(DOC, silent)[0]?.message).toContain(`will declare ${DEFAULT_PDF_LANG}`);
  });

  // An untagged document writes no `/Lang` at all, so there is nothing for it to be wrong about.
  test("says nothing about an unset language on a document that carries no structure tree", () => {
    const { lang: _unset, ...silent } = CONFORMANT;
    expect(rules(DOC, { ...silent, tagged: false })).not.toContain("lang-default");
  });
});

describe("the title a checker reads", () => {
  test("reports metadata that writes no dictionary, and asks about no title until it does", () => {
    expect(rules(DOC, { ...CONFORMANT, metadata: "none" })).toEqual(["metadata"]);
  });

  test("reports an empty title, since a viewer told to show one then has nothing", () => {
    expect(rules(DOC, { ...CONFORMANT, info: { title: " " } })).toContain("title");
  });

  // The audit models the render, and the render writes `pdfWritableInfo(info)` — so judging the raw
  // value names two strings a reader sees as identical and refuses a file the renderer gets right.
  const STRIPPED = "Declaration of interest\u0000";

  test("says nothing where the two titles differ only by what XML cannot carry", () => {
    expect(auditPdf(DOC, { ...CONFORMANT, info: { title: STRIPPED } })).toEqual([]);
  });

  test("agrees with the file the renderer writes, which is what the case above rests on", async () => {
    const rendered = await createPdfRenderer({ metadata: "standard", info: { title: STRIPPED }, compress: false }).render(DOC);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(new TextDecoder("latin1").decode(rendered.data)).toContain(`/Title (${DOC.title})`);
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

describe("the UA-1 blockers an audit can see before a render is made", () => {
  const HOLLOW: PdfEmbeddedFont = { ...FACE, sfnt: new Uint8Array() };

  test("reports a face supplied with no bytes, which the fonts rule counts as satisfied", () => {
    expect(rules(DOC, { ...CONFORMANT, fonts: [HOLLOW] })).toEqual(["embedded-face"]);
    expect(rules(DOC, { ...CONFORMANT, fonts: [HOLLOW] })).not.toContain("fonts");
  });

  test("reports a malformed language tag, which reaches /Lang and fails UA-1 as a missing one does", () => {
    expect(rules(DOC, { ...CONFORMANT, lang: "English" })).toEqual(["lang"]);
    expect(rules(DOC, { ...CONFORMANT, lang: "en" })).toEqual([]);
    expect(rules(DOC, { ...CONFORMANT, lang: "en-Latn-ZA" })).toEqual([]);
  });

  // RFC 5646 §2.1.1: the casing is a convention and not the grammar, so a tag written in any of it
  // names the same language — and reporting one of them malformed sends a caller to fix nothing.
  test("takes a tag in any casing, since subtag case carries no meaning", () => {
    for (const lang of ["en-za", "EN-ZA", "En-Za", "en-ZA"]) expect(rules(DOC, { ...CONFORMANT, lang })).toEqual([]);
  });

  test("reports a Table with no header row, and says nothing about one that has it", () => {
    const words = (run: string): PdfElement => Text({ children: run });
    const bare: PdfDocument = { ...DOC, content: [Table({ rows: [[words("Meridian"), words("2019")]] })] };
    expect(rules(bare, CONFORMANT)).toEqual(["table-header"]);
    const headed: PdfDocument = { ...DOC, content: [Table({ header: [words("Interest")], rows: [[words("Meridian")]] })] };
    expect(rules(headed, CONFORMANT)).toEqual([]);
  });

  test("reports a drawing in the reading order with no alt, and says nothing about a described one", () => {
    const commands = createPdfPen().move(0, 0).line(10, 0).commands();
    const bare: PdfDocument = { ...DOC, content: [Path({ commands, height: 10, stroke: [0, 0, 0] })] };
    expect(rules(bare, CONFORMANT)).toEqual(["alt"]);
    const described: PdfDocument = { ...DOC, content: [Path({ commands, height: 10, stroke: [0, 0, 0], alt: "A rule" })] };
    expect(rules(described, CONFORMANT)).toEqual([]);
  });

  // `toPdfElements` stops at a built element, so before the walk every one of these audited clean —
  // which is the worse failure, because a clean audit is what a caller ships on.
  test("reads past a wrapper, so a Table or a drawing nested in one is reported as a bare one is", () => {
    const words = (run: string): PdfElement => Text({ children: run });
    const commands = createPdfPen().move(0, 0).line(10, 0).commands();
    const table = Table({ rows: [[words("Meridian")]] });
    const drawing = Path({ commands, height: 10, stroke: [0, 0, 0] });
    expect(rules({ ...DOC, content: [Stack({ children: [table] })] }, CONFORMANT)).toEqual(["table-header"]);
    expect(rules({ ...DOC, content: [Stack({ children: [drawing] })] }, CONFORMANT)).toEqual(["alt"]);
    expect(rules({ ...DOC, content: [Stack({ children: [Box({ children: [table] })] })] }, CONFORMANT)).toEqual(["table-header"]);
  });

  test("reads into a Table's own cells, where a drawing is as invisible to a reader as anywhere else", () => {
    const commands = createPdfPen().move(0, 0).line(10, 0).commands();
    const cell = Path({ commands, height: 10, stroke: [0, 0, 0] });
    const content = [Table({ header: [Text({ children: "Interest" })], rows: [[cell]] })];
    expect(rules({ ...DOC, content }, CONFORMANT)).toEqual(["alt"]);
  });

  test("says nothing structural about an untagged document, which is already reported as untagged", () => {
    const bare: PdfDocument = { ...DOC, content: [Table({ rows: [] })] };
    expect(rules(bare, { ...CONFORMANT, tagged: false })).toEqual(["tagged"]);
  });
});

// A band is painted inside `furniture("pagination")` and UA-1 exempts an artifact from the structure
// tree and from alt alike, so a finding here sends a caller to add an `alt` reaching no byte.
describe("a running header and footer are furniture, so their contents are not the audit's to report", () => {
  const commands = createPdfPen().move(0, 0).line(10, 0).commands();
  const drawing = Path({ commands, height: 10, stroke: [0, 0, 0] });
  const table = Table({ rows: [[Text({ children: "Meridian" })]] });
  const BANDED: PdfDocument = { ...DOC, header: [table], footer: [drawing], content: [Text({ children: "A line." })] };

  test("says nothing about a header-less Table or an undescribed drawing inside one", () => {
    expect(rules(BANDED, CONFORMANT)).toEqual([]);
  });

  // A *described* drawing, because an undescribed one produces no `/Figure` wherever it sits — so
  // asserting on that fixture would pass with the banding deleted, which is no claim at all.
  test("because neither reaches the structure tree at all, which is what makes silence correct", async () => {
    const described = Path({ commands, height: 10, stroke: [0, 0, 0], alt: "A rule" });
    const rendered = await createPdfRenderer({ tagged: true, compress: false }).render({ ...BANDED, footer: [described] });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const written = new TextDecoder("latin1").decode(rendered.data);
    expect(written).toContain("/Artifact << /Type /Pagination >>");
    expect(written).not.toContain("/S /Table");
    expect(written).not.toContain("/S /Figure");
  });

  // Both halves of the case above read as claims only while the same elements in `content` do reach
  // the tree — the control that turns two absences into a statement about banding.
  test("where the same two elements placed in content do reach it", async () => {
    const described = Path({ commands, height: 10, stroke: [0, 0, 0], alt: "A rule" });
    const rendered = await createPdfRenderer({ tagged: true, compress: false }).render({ ...DOC, content: [table, described] });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const written = new TextDecoder("latin1").decode(rendered.data);
    expect(written).toContain("/S /Table");
    expect(written).toContain("/S /Figure");
  });

  // The one piece of front matter that is content rather than furniture — it enters the tree on the
  // page a reader first meets it — and the audit already reports it, which is the line this holds.
  test("while the letterhead's mark, which does reach the tree, is still reported", () => {
    const mark: PdfArtwork = { width: 1, height: 1, paths: [] };
    const letterhead = { name: "Meridian", tagline: "Practice", email: "a@b.example", phone: "+27 21 555 0143", mark };
    expect(rules({ ...BANDED, letterhead }, CONFORMANT)).toEqual(["alt"]);
  });
});

// The guarantee the shared table exists for, asserted rather than argued: a prohibition added to
// `conformance.ts` that only the refusal covers makes this fail, because the audit stops matching it.
describe("the audit reports exactly what the renderer would refuse", () => {
  const ARCHIVAL: PdfRendererOptions = { ...CONFORMANT, archival: "a-2a", info: { ...CONFORMANT.info, created: new Date(Date.UTC(2026, 8, 21)) } };

  function refusals(options: PdfRendererOptions): PdfConformanceRule[] {
    const { pages } = paginateWithin(
      DOC_WITH_LINK,
      {},
      resolvePdfPage(),
      {},
      resolveTypesetting(options.fonts, options.defaultFont),
      DEFAULT_PDF_MAX_PAGES,
    );
    return conformanceViolations(pages, options, options.archival ?? "a-2b").map((broken) => broken.rule);
  }

  test("every prohibition the table returns is a finding the audit also returns", () => {
    const broken: PdfRendererOptions = { ...ARCHIVAL, metadata: "none", tagged: false, fonts: undefined, defaultFont: undefined, info: {} };
    const reported = auditPdf(DOC_WITH_LINK, broken).map((finding) => finding.rule);
    for (const rule of refusals(broken)) expect(reported).toContain(rule);
    expect(refusals(broken).length).toBeGreaterThan(3);
  });

  test("a document that can produce the level it asks for still audits clean", () => {
    expect(auditPdf(DOC_WITH_LINK, ARCHIVAL)).toEqual([]);
  });

  test("says nothing about PDF/A where no level is asked for", () => {
    expect(auditPdf(DOC_WITH_LINK, { ...ARCHIVAL, archival: undefined }).map((finding) => finding.rule)).not.toContain("date");
  });
});
