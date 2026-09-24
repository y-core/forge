import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PageBreak } from "./components";
import { parsePdfText } from "./conform/parse.fixture";
import { Field, Heading, Note, OptionGroup, SignatureRow, TickList } from "./form";
import { Image } from "./graphics";
import { createPdfImage } from "./image";
import { jpegBytes } from "./image.fixture";
import { DEFAULT_PDF_LANG, DEFAULT_PDF_MAX_PAGES } from "./limits";
import { createPdfRenderer } from "./renderer";
import type { PdfArtwork, PdfDocument, PdfElement, PdfEmbeddedFont } from "./types";

// The bytes of a face are written opaquely and never parsed, and no node here is set in it — the
// face is present so the default has something to follow.
const FACE: PdfEmbeddedFont = {
  name: "body",
  postScriptName: "Body-Regular",
  sfnt: new Uint8Array(),
  glyphs: new Map(),
  metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, bbox: [0, 0, 1000, 1000], advances: new Map() },
};

const decoder = new TextDecoder("latin1");

function documentOf(breaks: number): PdfDocument {
  const row = (): PdfElement => Field({ fields: [{ label: "Surname", value: "Du Toit" }] });
  const content: PdfElement[] = [row()];
  for (let at = 0; at < breaks; at += 1) content.push(PageBreak(), row());
  return { title: "Declaration", content };
}

describe("createPdfRenderer", () => {
  test("renders a document to the bytes of a PDF 1.5 file, the version its cross-reference stream needs", async () => {
    const rendered = await createPdfRenderer().render(documentOf(0));
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.data).toBeInstanceOf(Uint8Array);
    expect(decoder.decode(rendered.data).startsWith("%PDF-1.5\n")).toBe(true);
  });

  test("renders the plainest file it can write: uncompressed, untagged, carrying no metadata and readable as text", async () => {
    const rendered = await createPdfRenderer({ compress: false, metadata: "none", tagged: false }).render(documentOf(0));
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(decoder.decode(rendered.data).startsWith("%PDF-1.4\n")).toBe(true);
  });

  // Pinned rather than derived: `/ID` hashes the uncompressed operators, so a caller caching a
  // render on its content must see the same identity across a change to how objects are located.
  test("keeps the identity v0.2.4 gave this document, under either cross-reference form", async () => {
    const identity = "[<cd88ebf78c7dab678001be8877ca70b3> <cd88ebf78c7dab678001be8877ca70b3>]";
    for (const compress of [true, false]) {
      const rendered = await createPdfRenderer({ metadata: "standard", compress }).render(documentOf(0));
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) return;
      expect(decoder.decode(rendered.data)).toContain(`/ID ${identity}`);
    }
  });

  test("answers a Result rather than throwing, so a failure is data", async () => {
    const rendered = await createPdfRenderer().render(documentOf(0));
    expect(Object.hasOwn(rendered, "ok")).toBe(true);
  });
});

// The namespace's one end-to-end case: a component that only ever renders beside its own kind is
// one whose interaction with the rest is untested. The mark is the asset pipeline's own output.
describe("a document using the whole component set renders as one file", () => {
  const MARK = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../tests/fixtures/mark/mark.json"), "utf-8")) as PdfArtwork;

  const POPULATED: PdfDocument = {
    title: "Declaration of interest",
    subtitle: "Financial Intelligence Centre Act, section 21",
    intro:
      "Complete every section in black ink. Where a question does not apply, rule the answer line through rather than leaving it blank, and initial the correction.",
    letterhead: {
      name: "Meridian Attorneys",
      tagline: "Commercial and estate practice",
      email: "records@meridian.example",
      phone: "+27 21 555 0143",
      mark: MARK,
    },
    content: [
      Heading({ children: "Part A - the declarant" }),
      Field({ fields: [{ label: "Surname", value: "Du Toit" }] }),
      Field({ fields: [{ label: "Identity number" }] }),
      Heading({ level: 2, children: "Contact" }),
      Field({
        fields: [
          { label: "Telephone", value: "+27 82 555 0197", span: 6 },
          { label: "Email", value: "annelie@example.org", span: 6 },
        ],
      }),
      Field({
        fields: [
          { label: "Street", value: "14 Rondebosch Avenue", span: 8 },
          { label: "Code", value: "7700", span: 4, labels: "above" },
        ],
      }),
      SignatureRow({
        cells: [
          { label: "City", value: "Cape Town" },
          { label: "Province", blank: true },
        ],
      }),
      OptionGroup({
        label: "In what capacity is the interest held?",
        options: [
          { label: "In my own name", mark: "ticked" },
          { label: "Through a trust", mark: "empty" },
          { label: "Through a company", mark: "crossed" },
        ],
      }),
      TickList({
        items: [
          { label: "Certified copy of identity document attached", mark: "ticked" },
          { label: "Proof of residential address attached", mark: "empty" },
        ],
      }),
      Note({ children: "A declaration that is incomplete on the date of signature is returned unprocessed." }),
      PageBreak(),
      Heading({ children: "Part C - signature" }),
      Field({ fields: [{ label: "Before me", value: "Commissioner of Oaths" }] }),
    ],
  };

  test("carries every part of the document, and the PageBreak puts the last heading on a second page", async () => {
    const rendered = await createPdfRenderer({ compress: false }).render(POPULATED);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const drawn = decoder.decode(rendered.data);
    expect(drawn).toContain("/Count 2");
    for (const run of ["Meridian Attorneys", "Du Toit", "Cape Town", "PART C - SIGNATURE", "Commissioner of Oaths"]) {
      expect(drawn).toContain(`(${run}) Tj`);
    }
  });
});

describe("tagged", () => {
  const read = async (options: Parameters<typeof createPdfRenderer>[0]): Promise<string> => {
    const rendered = await createPdfRenderer({ compress: false, ...options }).render(documentOf(0));
    if (!rendered.ok) throw new Error(rendered.error.message);
    return new TextDecoder("latin1").decode(rendered.data);
  };

  test("writes the structure tree, and declares the language the caller names", async () => {
    const drawn = await read({ tagged: true, lang: "af" });
    expect(drawn).toContain("/StructTreeRoot");
    expect(drawn).toContain("/Lang (af)");
  });

  test("falls back to the documented default language rather than declaring none", async () => {
    expect(await read({ tagged: true })).toContain(`/Lang (${DEFAULT_PDF_LANG})`);
  });

  test("writes no structure object where it is off, so an untagged file claims no structure at all", async () => {
    expect(await read({ tagged: false })).not.toContain("StructTreeRoot");
  });

  test("defaults to on where the caller supplies a face, and to off where there is none to embed", async () => {
    expect(await read({ fonts: [FACE] })).toContain("/StructTreeRoot");
    expect(await read({})).not.toContain("StructTreeRoot");
  });

  test("takes an explicit answer over the faces, in either direction", async () => {
    expect(await read({ tagged: false, fonts: [FACE] })).not.toContain("StructTreeRoot");
    expect(await read({ tagged: true })).toContain("/StructTreeRoot");
  });
});

// The claim is agreement: both blocks are derived from one title, so what this pins is that neither
// is written in an encoding the other's reader decodes differently.
describe("the title /Info carries and the title XMP carries are the same string", () => {
  async function titles(title: string): Promise<[string, string]> {
    const rendered = await createPdfRenderer({ compress: false, metadata: "standard", info: { title } }).render({ title, content: [] });
    if (!rendered.ok) throw new Error(rendered.error.message);
    // The packet is UTF-8 in the file and the dictionary is not, so each is read as what it is.
    const packet = /<rdf:li xml:lang="x-default">([^<]*)<\/rdf:li>/.exec(new TextDecoder().decode(rendered.data))?.[1] ?? "";
    return [decodedTitle(new TextDecoder("latin1").decode(rendered.data)), packet];
  }

  // Decoded by what the bytes themselves declare: a marked string is UTF-16BE, a bare literal ASCII.
  function decodedTitle(drawn: string): string {
    const hex = /\/Title <FEFF([\dA-F]*)>/.exec(drawn)?.[1];
    if (hex === undefined) return /\/Title \(([^)]*)\)/.exec(drawn)?.[1] ?? "";
    return (hex.match(/.{4}/g) ?? []).map((unit) => String.fromCharCode(Number.parseInt(unit, 16))).join("");
  }

  test("agree on a title carrying the quotes and dashes a word processor produces", async () => {
    const [info, packet] = await titles("Smith’s Declaration — 2026");
    expect(info).toBe("Smith’s Declaration — 2026");
    expect(packet).toBe(info);
  });

  test("agree on an ASCII title, which a bare literal already encodes correctly", async () => {
    const [info, packet] = await titles("Declaration of interest");
    expect(info).toBe("Declaration of interest");
    expect(packet).toBe(info);
  });
});

describe("maxPages", () => {
  test("refuses a document over the ceiling by name, with no bytes produced", async () => {
    const rendered = await createPdfRenderer({ maxPages: 2 }).render(documentOf(4));
    expect(rendered.ok).toBe(false);
    if (rendered.ok) return;
    expect(rendered.error.kind).toBe("max-pages");
    expect(rendered.error.message).toContain("2-page ceiling");
  });

  test("takes DEFAULT_PDF_MAX_PAGES where the caller names none", async () => {
    const over = await createPdfRenderer().render(documentOf(DEFAULT_PDF_MAX_PAGES + 1));
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error.message).toContain(`${DEFAULT_PDF_MAX_PAGES}-page ceiling`);
  });

  test("renders a document exactly at the ceiling", async () => {
    const rendered = await createPdfRenderer({ maxPages: 3 }).render(documentOf(2));
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(await parsePdfText(rendered.data)).toContain("/Count 3");
  });
});

describe("a document carrying an image reaches the file, on both the filtered and the plain path", () => {
  async function drawn(compress: boolean): Promise<Uint8Array<ArrayBuffer>> {
    const image = await createPdfImage(jpegBytes(10, 10, 3));
    if (!image.ok) throw new Error(image.error.message);
    const doc: PdfDocument = { title: "Declaration", content: Image({ image: image.data, width: 50 }) };
    const rendered = await createPdfRenderer({ compress }).render(doc);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) throw new Error(rendered.error.message);
    return rendered.data;
  }

  // The filtered leg asks the resolved objects and the plain leg asks the bytes, because a page
  // dictionary is packed into an `/ObjStm` on one and written where a reader can see it on the other.
  test("names the image object in the page's resources, with its stream deflated", async () => {
    const text = await parsePdfText(await drawn(true));
    expect(text).toContain("/XObject << /Im0");
    expect(text).toContain("/Type /XObject /Subtype /Image");
  });

  test("names it identically where the streams are left as they are", async () => {
    const text = decoder.decode(await drawn(false));
    expect(text).toContain("/XObject << /Im0");
    expect(text).toContain("/Im0 Do Q");
  });
});

describe("a document the base-14 faces cannot set", () => {
  const withRun = (run: string): PdfDocument => ({ title: "Declaration", content: [Field({ fields: [{ label: "Name", value: run }] })] });

  test("is refused by name, before a byte is written", async () => {
    const rendered = await createPdfRenderer().render(withRun("Du Toit 価"));
    expect(rendered.ok).toBe(false);
    if (rendered.ok) return;
    expect(rendered.error.kind).toBe("encoding");
    expect(rendered.error.message).toContain("U+4FA1");
  });

  test("renders where every character is covered, accents included", async () => {
    expect((await createPdfRenderer().render(withRun("Vlëer Ö æ ß"))).ok).toBe(true);
  });
});
