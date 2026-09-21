import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PageBreak } from "./components";
import { Field, Heading, Note, OptionGroup, SignatureRow, TickList } from "./form";
import { paginate } from "./paginate";
import { createPdfRenderer } from "./renderer";
import { structureElements } from "./structure";
import type { PdfArtwork, PdfDocument, PdfElement } from "./types";

const MARK = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../tests/fixtures/mark/mark.json"), "utf-8")) as PdfArtwork;

function part(index: number): PdfElement[] {
  return [
    Heading({ children: `Part ${index} - the declarant` }),
    ...Array.from({ length: 12 }, () => Field({ fields: [{ label: "Surname", value: "Du Toit" }] })),
    OptionGroup({
      label: "In what capacity is the interest held?",
      options: [
        { label: "In my own name", mark: "ticked" },
        { label: "Through a trust", mark: "empty" },
      ],
    }),
    TickList({ items: [{ label: "Certified copy of identity document attached", mark: "ticked" }] }),
    SignatureRow({
      cells: [
        { label: "City", value: "Cape Town" },
        { label: "Province", blank: true },
      ],
    }),
    Note({ children: "A declaration that is incomplete on the date of signature is returned unprocessed." }),
    PageBreak(),
  ];
}

const FULLEST: PdfDocument = {
  title: "Declaration of interest",
  subtitle: "Financial Intelligence Centre Act, section 21",
  intro: "Complete every section in black ink. Where a question does not apply, rule the answer line through rather than leaving it blank.",
  letterhead: {
    name: "Meridian Attorneys",
    tagline: "Commercial and estate practice",
    email: "records@meridian.example",
    phone: "+27 21 555 0143",
    mark: MARK,
  },
  content: [0, 1, 2].flatMap((index) => part(index)),
};

async function bytesOf(tagged: boolean): Promise<number> {
  const rendered = await createPdfRenderer({ tagged, metadata: "standard" }).render(FULLEST);
  if (!rendered.ok) throw new Error(rendered.error.message);
  return rendered.data.length;
}

// Measured 2026-09-21 on this fixture: 4,944 untagged, 7,192 tagged, 118 structure elements.
const UNTAGGED_CEILING = 8000;
const TAGGED_RATIO_CEILING = 1.6;
const BYTES_PER_ELEMENT_CEILING = 30;

describe("tagging is affordable, which is the whole case for a tagged document", () => {
  test("the untagged render stays under its own ceiling, so a ratio cannot pass by both files growing", async () => {
    expect(await bytesOf(false)).toBeLessThan(UNTAGGED_CEILING);
  });

  // This fixture embeds no face, so the tree is a far larger share of it than of a document set in
  // one — the ratio is read against that, and the per-element figure below is what does not move.
  test("the tagged render stays within the ratio this fixture was measured at", async () => {
    expect((await bytesOf(true)) / (await bytesOf(false))).toBeLessThan(TAGGED_RATIO_CEILING);
  });

  // The figure the object-stream work actually moved, and the one a fixture's own bulk cannot
  // flatter: an unpacked, uncompressed structure element cost about 112 bytes before this wave.
  test("a structure element costs a fraction of what a top-level uncompressed object cost", async () => {
    const elements = structureElements(paginate(FULLEST)).length;
    expect(elements).toBeGreaterThan(100);
    expect(((await bytesOf(true)) - (await bytesOf(false))) / elements).toBeLessThan(BYTES_PER_ELEMENT_CEILING);
  });
});
