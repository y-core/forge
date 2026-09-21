import { describe, expect, test } from "bun:test";

import { PageBreak, Text } from "../components";
import { Field, Heading, OptionGroup, TickList } from "../form";
import { Path } from "../graphics";
import { Link } from "../link";
import { createPdfPen } from "../path";
import { createPdfRenderer } from "../renderer";
import { Table } from "../table";
import type { PdfDocument, PdfElement, PdfEmbeddedFont, PdfRendererOptions } from "../types";
import { conformPdf } from "./conform.fixture";

const decoder = new TextDecoder("latin1");
const pen = createPdfPen().move(0, 0).line(40, 0).line(40, 20).close();
const words = (run: string): PdfElement => Text({ children: run });

// Everything this wave taught the writer, in one document: a nested tree, a table with a header, a
// list of tick boxes, a link, a figure with alternate text, and a break to make a container span.
const CONFORMANT: PdfDocument = {
  title: "Declaration of interest",
  subtitle: "Financial Intelligence Centre Act, section 21",
  header: Text({ children: "Declaration of interest" }),
  content: [
    Heading({ children: "Part A - the declarant" }),
    Field({ fields: [{ label: "Surname", value: "Du Toit" }] }),
    Heading({ level: 2, children: "Contact" }),
    Path({ commands: pen.commands(), height: 20, alt: "The Meridian mark", stroke: [0, 0, 0] }),
    Table({ header: [words("Interest"), words("Held since")], rows: [[words("Meridian Holdings"), words("2019")]] }),
    TickList({
      items: [
        { label: "Certified copy attached", mark: "ticked" },
        { label: "Proof of address attached", mark: "empty" },
      ],
    }),
    OptionGroup({ label: "In what capacity?", options: [{ label: "In my own name", mark: "ticked" }] }),
    Link({ to: { uri: "https://example.test/terms" }, children: [Text({ children: "the terms" })] }),
    PageBreak(),
    Heading({ children: "Part B - signature" }),
    Text({ children: "Signed before me." }),
  ],
};

async function rendered(doc: PdfDocument, compress: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const out = await createPdfRenderer({ tagged: true, compress }).render(doc);
  if (!out.ok) throw new Error(out.error.message);
  return out.data;
}

function mutated(bytes: Uint8Array<ArrayBuffer>, from: string | RegExp, to: string): Uint8Array<ArrayBuffer> {
  const text = decoder.decode(bytes).replace(from, to);
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

describe("a tagged render reports no UA-1 structural finding", () => {
  test("on the uncompressed file and on the packed one alike", async () => {
    for (const compress of [false, true]) expect(await conformPdf(await rendered(CONFORMANT, compress))).toEqual([]);
  });

  test("on a document made of nothing but a title, which is the smallest tagged file", async () => {
    expect(await conformPdf(await rendered({ title: "Declaration", content: [Text({ children: "One line." })] }, false))).toEqual([]);
  });
});

// A checker nothing has ever seen fail is not yet a check, so each rule is shown rejecting a file
// broken in exactly the way that rule exists to catch.
describe("the checker rejects a file broken in the way each rule names", () => {
  test("a root listing something other than one /Document", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), "/S /Document", "/S /Part");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("document-root");
  });

  test("a figure whose alternate text has been taken away", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), / \/Alt \(The Meridian mark\)/, "");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("figure-alt");
  });

  test("a heading level that skips, which is the one a nested tree can introduce", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), "/S /H2", "/S /H4");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("heading-skip");
  });

  test("a table row holding something that is not a cell", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), "/S /TH", "/S /P");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("table-shape");
  });

  test("a list item holding something that is neither a label nor a body", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), "/S /Lbl", "/S /P");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("list-shape");
  });

  test("a parent-tree entry transposed, so a marked run resolves to the wrong element", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), /\/Nums \[0 \[(\d+) 0 R (\d+) 0 R/, "/Nums [0 [$2 0 R $1 0 R");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("mcid-unresolved");
  });

  test("a file declaring no structure at all", async () => {
    const out = await createPdfRenderer({ tagged: false, compress: false }).render(CONFORMANT);
    if (!out.ok) throw new Error(out.error.message);
    expect((await conformPdf(out.data)).map((found) => found.rule)).toEqual(["document-root"]);
  });
});

// Each proved by a hand-broken file rather than by a passing render: this checker reads through the
// writer's own sibling parser, so a rule shown only in the green is a rule that agrees with a bug.
describe("the checker holds the annotation edge the tree depends on", () => {
  test("an annotation with no /StructParent", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), / \/StructParent \d+/, "");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("annot-parent");
  });

  test("a key that resolves to no element, because /Nums never listed it", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), /\] \d+ \d+ 0 R/, "]");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("annot-parent");
  });

  test("an annotation that does not set /F 4", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), "/F 4", "/F 0");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("annot-flags");
  });

  // The rule that would have caught bug-260921-87: an annotation described with another link's words.
  test("a /Contents that is not the words its own element paints", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), /\/Contents \([^)]*\)/, "/Contents (some other link)");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("annot-contents");
  });

  test("a tagged page carrying no /Tabs /S", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), " /Tabs /S", "");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("page-tabs");
  });

  test("a /ParentTreeNextKey that does not exceed every key issued", async () => {
    const broken = mutated(await rendered(CONFORMANT, false), /\/ParentTreeNextKey \d+/, "/ParentTreeNextKey 1");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("parent-tree-next-key");
  });

  // The collision one shared counter was chosen to make impossible, so the rule guarding it is the
  // one a reader would most readily assume held itself.
  test("two annotations claiming one /StructParent key", async () => {
    const twoLinks: PdfDocument = {
      title: "Declaration",
      content: [
        Link({ to: { uri: "https://example.org/terms" }, children: [Text({ children: "Terms of use" })] }),
        Link({ to: { uri: "https://example.org/privacy" }, children: [Text({ children: "Privacy notice" })] }),
      ],
    };
    const clean = await rendered(twoLinks, false);
    expect(await conformPdf(clean)).toEqual([]);
    const broken = mutated(clean, "/StructParent 2 ", "/StructParent 1 ");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("annot-key");
  });
});

describe("the annotation rules see the defect bug-260921-87 was filed for", () => {
  test("a wordless link before a texted one leaves every annotation clean", async () => {
    const commands = createPdfPen().move(0, 0).line(40, 0).close().commands();
    const doc: PdfDocument = {
      title: "Declaration",
      content: [
        Link({ to: { uri: "https://example.org/mark" }, children: [Path({ commands, height: 20, stroke: [0, 0, 0] })] }),
        Link({ to: { uri: "https://example.org/terms" }, children: [Text({ children: "Terms of use" })] }),
      ],
    };
    expect(await conformPdf(await rendered(doc, false))).toEqual([]);
  });
});

const FACE: PdfEmbeddedFont = {
  name: "body",
  postScriptName: "Body-Regular",
  sfnt: new Uint8Array([0, 1, 0, 0]),
  glyphs: new Map(Array.from({ length: 96 }, (_glyph, at) => [at + 32, at + 3] as const)),
  metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, bbox: [0, 0, 1000, 1000], advances: new Map() },
};

const ARCHIVAL: PdfRendererOptions = {
  archival: "a-2a",
  tagged: true,
  metadata: "standard",
  compress: false,
  fonts: [FACE],
  defaultFont: { regular: "body", bold: "body" },
  info: { title: "Declaration", created: new Date(Date.UTC(2026, 8, 21)) },
};

async function archival(options: PdfRendererOptions = ARCHIVAL): Promise<Uint8Array<ArrayBuffer>> {
  const out = await createPdfRenderer(options).render({ title: "Declaration", content: [Text({ children: "A line." })] });
  if (!out.ok) throw new Error(out.error.message);
  return out.data;
}

describe("a file declaring PDF/A is held to what that declaration promises", () => {
  test("an archival render reports no finding at any level admitted", async () => {
    for (const level of ["a-2b", "a-2u", "a-2a"] as const) expect(await conformPdf(await archival({ ...ARCHIVAL, archival: level }))).toEqual([]);
  });

  test("a file declaring no level is not held to PDF/A at all", async () => {
    expect(await conformPdf(await archival({ ...ARCHIVAL, archival: undefined }))).toEqual([]);
  });

  test("a conformance letter with no part, which declares half a level", async () => {
    const broken = mutated(await archival(), "<pdfaid:part>2</pdfaid:part>", "");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("pdfa-declaration");
  });

  // The case this epic exists to produce: both standards in one packet, which PDF/A admits only
  // where the pdfuaid schema is described beside it.
  test("both standards declared without the extension schema describing the second", async () => {
    const broken = mutated(await archival(), /<pdfaExtension:schemas>[\S\s]*?<\/pdfaExtension:schemas>/, "");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("pdfa-declaration");
  });

  test("an output intent taken away, and a destination profile of the wrong device class", async () => {
    const none = mutated(await archival(), "/Type /OutputIntent", "/Type /Nothing");
    expect((await conformPdf(none)).map((found) => found.rule)).toContain("output-intent");
    const wrong = mutated(await archival(), "mntrRGB", "spacRGB");
    expect((await conformPdf(wrong)).map((found) => found.rule)).toContain("output-intent");
  });

  test("a base-14 face, whose glyphs the file does not carry", async () => {
    const broken = mutated(await archival(), "/Type /Font /Subtype /Type0", "/Type /Font /Subtype /Type1");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("font-not-embedded");
  });

  test("a page that composites with no blending space named", async () => {
    const shaded = await createPdfRenderer(ARCHIVAL).render({
      title: "Declaration",
      content: [
        Path({
          commands: createPdfPen().move(0, 0).line(40, 0).close().commands(),
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
    });
    if (!shaded.ok) throw new Error(shaded.error.message);
    expect(await conformPdf(shaded.data)).toEqual([]);
    const broken = mutated(shaded.data, " /Group << /S /Transparency /CS /DeviceRGB >>", "");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("transparency-group");
  });
});

describe("the dictionary and the packet are held to saying the same thing", () => {
  const FULL: PdfRendererOptions = {
    ...ARCHIVAL,
    info: {
      title: "Declaration",
      author: "Annelie du Toit",
      subject: "Financial interests",
      keywords: "fica, declaration",
      creator: "Meridian Attorneys",
      producer: "@y-core/forge",
      created: new Date(Date.UTC(2026, 8, 21)),
      modified: new Date(Date.UTC(2026, 8, 22)),
    },
  };

  // The case the caller reaches by doing something ordinary: filling in the metadata the option
  // exists for. Three of these had no XMP counterpart at all, and every one was a refusal.
  test("an archival render setting every info field reports no mismatch", async () => {
    expect(await conformPdf(await archival(FULL))).toEqual([]);
  });

  test("a value the packet contradicts", async () => {
    const broken = mutated(await archival(FULL), "<rdf:li>Annelie du Toit</rdf:li>", "<rdf:li>Someone Else</rdf:li>");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("info-xmp-mismatch");
  });

  test("a value the packet carries no counterpart for at all", async () => {
    const broken = mutated(await archival(FULL), /<pdf:Keywords>[^<]*<\/pdf:Keywords>/, "");
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("info-xmp-mismatch");
  });

  // A dictionary value leaves the literal form the moment it carries an accent or a dash, which is
  // the ordinary case for a real title — so a rule reading only literals never ran on one.
  const ACCENTED: PdfRendererOptions = { ...FULL, info: { ...FULL.info, title: "Déclaration" } };

  test("a hex-string value the packet agrees with reports nothing", async () => {
    const file = await archival(ACCENTED);
    expect(decoder.decode(file)).toContain("/Title <FEFF");
    expect(await conformPdf(file)).toEqual([]);
  });

  test("a hex-string value the packet contradicts is still reported", async () => {
    const title = /<rdf:li xml:lang="x-default">[^<]*<\/rdf:li>/;
    const broken = mutated(await archival(ACCENTED), title, '<rdf:li xml:lang="x-default">Something else</rdf:li>');
    expect((await conformPdf(broken)).map((found) => found.rule)).toContain("info-xmp-mismatch");
  });
});
