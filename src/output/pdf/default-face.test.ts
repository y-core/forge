import { describe, expect, test } from "bun:test";

import { buildFontPacks, HARFBUZZ_SUBSET_WASM } from "../../tooling/assets/font-build";
import { Stack, Text } from "./components";
import { readPdfEmbeddedFonts } from "./fonts/embedded";
import { Field, Heading, Note, OptionGroup, SignatureRow, TickList } from "./form";
import { describePdfLayout } from "./layout";
import { createPdfRenderer } from "./renderer";
import { textWidth } from "./text";
import type { PdfDocument, PdfElement, PdfEmbeddedFont, PdfLayoutText, PdfRendererOptions } from "./types";
import { resolveTypesetting } from "./typesetting";

const decoder = new TextDecoder("latin1");

// The marks every fixture below sets, and nothing else: the subset is the coverage, so a test about
// an uncovered glyph only has to name one outside this line.
const COVERED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz 0123456789-.,'?()/@+";

async function face(weight: string, name: string): Promise<PdfEmbeddedFont> {
  const from = `node_modules/@expo-google-fonts/oswald/${weight}/Oswald_${weight}.ttf`;
  const built = await buildFontPacks([{ family: "Oswald", from, to: `fonts/${name}.ttf`, covering: COVERED }], HARFBUZZ_SUBSET_WASM);
  return readPdfEmbeddedFonts(
    built.packs[0]!,
    (path) => built.sfnt.get(path) ?? new Uint8Array(),
    () => name,
  )[0]!;
}

const REGULAR = await face("400Regular", "oswald");
const BOLD = await face("700Bold", "oswald-bold");

const FONTS = [REGULAR, BOLD];
const DEFAULT_FACES = { regular: "oswald", bold: "oswald-bold" };
const DEFAULTED: PdfRendererOptions = { fonts: FONTS, defaultFont: DEFAULT_FACES, compress: false, tagged: false };

function documentOf(content: PdfElement[], extra: Partial<PdfDocument> = {}): PdfDocument {
  return { title: "Declaration", content, ...extra };
}

async function streamOf(doc: PdfDocument, options: PdfRendererOptions = DEFAULTED): Promise<string> {
  const rendered = await createPdfRenderer(options).render(doc);
  if (!rendered.ok) throw new Error(`${rendered.error.kind}: ${rendered.error.message}`);
  return decoder.decode(rendered.data);
}

async function errorOf(doc: PdfDocument, options: PdfRendererOptions): Promise<{ kind: string; message: string }> {
  const rendered = await createPdfRenderer(options).render(doc);
  if (rendered.ok) throw new Error("expected a refusal, got a rendered file");
  return rendered.error;
}

function textsOf(doc: PdfDocument, options: PdfRendererOptions = DEFAULTED): PdfLayoutText[] {
  const described = describePdfLayout(doc, options);
  if (!described.ok) throw new Error(`${described.error.kind}: ${described.error.message}`);
  return described.data.pages.flatMap((page) => page.nodes.flatMap((node) => (node.kind === "text" ? [node] : [])));
}

/** Every font resource a content stream selects, in the order it selects them. */
function resourcesOf(stream: string): string[] {
  return [...stream.matchAll(/BT \/(\S+) /g)].map((found) => found[1] ?? "");
}

/** Every font resource a page declares, whether or not any run selects it. */
function declaredOf(file: string): string[] {
  return [...(/\/Font << ([^>]*) >>/.exec(file)?.[1] ?? "").matchAll(/\/(\S+) \d+ 0 R/g)].map((found) => found[1] ?? "");
}

const PLAIN = documentOf([Stack({ children: [Text({ children: "Declaration of interest" })] })]);

describe("defaultFont — what a document naming one is refused for", () => {
  test("refuses a default naming a face `fonts` does not carry, and renders where it does", async () => {
    const refused = await errorOf(PLAIN, { ...DEFAULTED, defaultFont: { regular: "oswald", bold: "absent" } });

    expect(refused.kind).toBe("font");
    expect(refused.message).toContain("absent");
    expect((await createPdfRenderer(DEFAULTED).render(PLAIN)).ok).toBe(true);
  });

  test("refuses a default with no `fonts` at all, and renders once they are supplied", async () => {
    const refused = await errorOf(PLAIN, { defaultFont: DEFAULT_FACES });

    expect(refused.kind).toBe("font");
    expect((await createPdfRenderer({ fonts: FONTS, defaultFont: DEFAULT_FACES }).render(PLAIN)).ok).toBe(true);
  });

  test("refuses a code point outside the subset by naming the face, not the base-14 pair", async () => {
    const outside = documentOf([Stack({ children: [Text({ children: "Zürich" })] })]);
    const refused = await errorOf(outside, DEFAULTED);

    expect(refused.kind).toBe("encoding");
    expect(refused.message).toContain("U+00FC");
    expect(refused.message).toContain("oswald");
    expect(refused.message).not.toContain("base-14");
  });
});

describe("defaultFont — the weight a run is set in", () => {
  // A single default face would collapse every bold run to the regular one silently, because the
  // writer discards `face` once a node carries `embedded`.
  test("sets a bold run in the bold entry and a regular run in the regular one", async () => {
    const stream = await streamOf(documentOf([Heading({ children: "Declaring party" }), Note({ children: "Read this" })]));
    const selected = new Set(resourcesOf(stream));

    expect(selected.size).toBe(2);
    expect(textsOf(documentOf([Heading({ children: "Declaring party" })])).some((node) => node.face === "bold")).toBe(true);
  });

  test("measures a bold run in the bold face's advances, which is what a collapse would lose", () => {
    const bold = textsOf(documentOf([SignatureRow({ cells: [{ label: "Signature", value: "Name" }] })]));
    const label = bold.find((node) => node.text === "Signature");
    const value = bold.find((node) => node.text === "Name");

    expect(label?.face).toBe("bold");
    expect(value?.face).toBe("regular");
  });
});

describe("defaultFont — what supplying fonts alone does", () => {
  test("moves nothing at all: a layout under `fonts` equals the layout under no options", () => {
    expect(describePdfLayout(PLAIN, { fonts: FONTS })).toEqual(describePdfLayout(PLAIN));
  });
});

describe("Text({ font }) — a run naming its own face in a defaulted document", () => {
  test("sets in the face it names rather than the document's", async () => {
    const own = documentOf([Stack({ children: [Text({ children: "Declaration", font: BOLD })] })]);
    const stream = await streamOf(own);
    const defaulted = await streamOf(documentOf([Stack({ children: [Text({ children: "Declaration" })] })]));

    expect(resourcesOf(stream)).not.toEqual(resourcesOf(defaulted));
  });

  test("falls back to the base-14 pair for a code point its own face cannot set, never to the default", async () => {
    // `ü` is outside both subsets, so a run that fell back to the document default would be refused
    // — reaching the `Tj` branch at all is the proof that the ladder ends at base-14.
    const own = documentOf([Stack({ children: [Text({ children: "Zürich", font: REGULAR })] })]);
    const stream = await streamOf(own);

    expect(stream).toContain("Tj");
  });
});

describe("the form vocabulary under a default face", () => {
  // An optional trailing parameter means a composite that forgets to forward it still typechecks
  // and fails silently, so every one of them is asserted rather than a sample.

  // Long enough to wrap in both faces: Oswald is condensed and breaks in different places, which is
  // the one probe that works whatever column a component sets in.
  const LONG =
    "Every person who ultimately owns or controls the party to this transfer and every person on whose behalf the declarant acts in this matter";

  const SAMPLES: readonly [name: string, of: () => PdfElement][] = [
    ["Heading", () => Heading({ children: LONG })],
    ["Note", () => Note({ children: LONG })],
    ["Field", () => Field({ fields: [{ label: "Surname", value: LONG }] })],
    ["TickList", () => TickList({ items: [{ label: LONG, mark: "ticked" }] })],
    [
      "OptionGroup",
      () =>
        OptionGroup({
          label: LONG,
          options: [
            { label: "One", mark: "ticked" },
            { label: "Two", mark: "empty" },
          ],
        }),
    ],
    ["SignatureRow", () => SignatureRow({ cells: [{ label: "Signature", value: LONG }] })],
  ];

  for (const [name, of] of SAMPLES) {
    test(`${name} measures in the default face rather than Helvetica`, () => {
      const doc = documentOf([of()]);
      const defaulted = textsOf(doc).map((node) => node.text);
      const base14 = textsOf(doc, { compress: false, tagged: false }).map((node) => node.text);

      expect(defaulted.join(" ")).toBe(base14.join(" "));
      expect(defaulted).not.toEqual(base14);
    });
  }
});

describe("the letterhead and the front matter under a default face", () => {
  const LETTERHEAD = {
    name: "Cornel Bouwer Incorporated",
    tagline: "Attorneys Conveyancers Notaries",
    email: "records@example.com",
    phone: "+27 83 276 2007",
  };

  test("still ends the right-aligned contact line at the content right edge, at the face's own width", () => {
    const doc = documentOf([Note({ children: "Read this" })], { letterhead: LETTERHEAD });
    const emailOf = (options: PdfRendererOptions): PdfLayoutText | undefined =>
      textsOf(doc, options).find((node) => node.text === LETTERHEAD.email);
    const defaulted = emailOf(DEFAULTED);
    const base14 = emailOf({ compress: false, tagged: false });

    const set = resolveTypesetting(FONTS, DEFAULT_FACES);

    expect(defaulted?.x).not.toBeCloseTo(base14?.x ?? 0, 3);
    // 539 is the content right edge of an A4 page at the default margins, which neither face moves:
    // the line starts somewhere else and still ends exactly there, each at its own width.
    expect((defaulted?.x ?? 0) + set.width(LETTERHEAD.email, 8.5)).toBeCloseTo(539, 3);
    expect((base14?.x ?? 0) + textWidth(LETTERHEAD.email, 8.5)).toBeCloseTo(539, 3);
  });

  test("refuses an uncovered glyph in the letterhead, which no form component drew", async () => {
    const doc = documentOf([Note({ children: "Read this" })], { letterhead: { ...LETTERHEAD, name: "Zürich Attorneys" } });
    const refused = await errorOf(doc, DEFAULTED);

    expect(refused.kind).toBe("encoding");
    expect(refused.message).toContain("oswald");
  });

  test("refuses an uncovered glyph in the title, which no form component drew either", async () => {
    const refused = await errorOf(documentOf([Note({ children: "Read this" })], { title: "Zürich" }), DEFAULTED);

    expect(refused.kind).toBe("encoding");
    expect(refused.message).toContain("oswald");
  });
});

describe("the base-14 pair a defaulted document does not carry", () => {
  test("declares neither Helvetica nor Helvetica-Bold, and names only embedded resources", async () => {
    const file = await streamOf(documentOf([Heading({ children: "Declaring party" }), Note({ children: "Read this" })]));

    expect(file).not.toContain("/BaseFont /Helvetica");
    expect(file).not.toContain("/BaseFont /Helvetica-Bold");
    expect(declaredOf(file).every((resource) => resource.startsWith("E"))).toBe(true);
    expect(declaredOf(file).length).toBe(2);
  });

  test("still numbers every object once, with each reference and each xref offset resolving", async () => {
    const file = await streamOf(documentOf([Heading({ children: "Declaring party" }), Note({ children: "Read this" })]));
    const bodies = new Map([...file.matchAll(/(\d+) 0 obj\n([\S\s]*?)\nendobj/g)].map((found) => [Number(found[1]), found[2] ?? ""]));
    // A subset's bytes are binary and can spell a reference by accident, so only the objects that
    // carry no stream are scanned — the trailer is read separately, for `/Root`.
    const dictionaries = [...bodies.values()].filter((body) => !body.includes("\nstream\n"));
    const trailer = file.slice(file.lastIndexOf("trailer"));
    const named = [...[...dictionaries, trailer].join(" ").matchAll(/(\d+) 0 R/g)].map((found) => Number(found[1]));

    expect(named.filter((id) => !bodies.has(id))).toEqual([]);
    expect(Number(/\/Size (\d+)/.exec(trailer)?.[1])).toBe(bodies.size + 1);

    const offsets = [...file.matchAll(/^(\d{10}) 00000 n $/gm)].map((found) => Number(found[1]));
    expect(offsets.length).toBe(bodies.size);
    expect(offsets.filter((offset, index) => !file.startsWith(`${index + 1} 0 obj`, offset))).toEqual([]);

    // A reference resolving is weaker than it looks: a page number two out still lands on an object
    // the embedded face allocated, so what each one resolves *to* is the assertion that bites.
    const tree = [...bodies.values()].find((body) => body.startsWith("<< /Type /Pages"));
    const kids = [...(/\/Kids \[([^\]]*)\]/.exec(tree ?? "")?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((found) => Number(found[1]));

    expect(kids.length).toBe(1);
    expect(kids.map((id) => (bodies.get(id) ?? "").startsWith("<< /Type /Page "))).toEqual([true]);
    const contents = kids.map((id) => Number(/\/Contents (\d+) 0 R/.exec(bodies.get(id) ?? "")?.[1]));
    expect(contents.map((id) => (bodies.get(id) ?? "").includes("\nstream\n"))).toEqual([true]);
  });

  test("keeps the pair for a document that supplies fonts and names no default", async () => {
    const file = await streamOf(PLAIN, { fonts: FONTS, compress: false, tagged: false });

    expect(file).toContain("/BaseFont /Helvetica-Bold");
    expect(declaredOf(file)).toContain("F1");
    expect(declaredOf(file)).toContain("F2");
  });

  test("keeps the pair for a defaulted document whose own-face run falls back to it", async () => {
    const own = documentOf([Stack({ children: [Text({ children: "Zürich", font: REGULAR })] })]);
    const file = await streamOf(own);

    expect(file).toContain("/BaseFont /Helvetica");
    expect(declaredOf(file)).toContain("F1");
    expect(declaredOf(file)).toContain("F2");
  });
});
