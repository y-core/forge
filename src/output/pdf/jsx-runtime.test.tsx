/** @jsxImportSource @y-core/forge/output/pdf */

import { describe, expect, test } from "bun:test";

import { createCursor } from "./cursor";
import { place } from "./elements";
import { Field, Heading } from "./form";
import { MARGIN, PAGE_WIDTH } from "./geometry";
import { paginate } from "./paginate";
import { toPdfElements } from "./tree";
import type { PdfBox, PdfContent, PdfDocument, PdfNode } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

function nodesOf(content: PdfContent): PdfNode[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  const from = cursor.pages.at(-1)?.nodes.length ?? 0;
  for (const element of toPdfElements(content)) place(cursor, element, MEASURE);
  return (cursor.pages.at(-1)?.nodes ?? []).slice(from);
}

// The README's sample, verbatim: if this file stops compiling, the documented spelling has stopped
// working, and the gate's typecheck step is what says so.
const doc: PdfDocument = {
  title: "Declaration of interest",
  content: (
    <>
      <Heading>Part A - the declarant</Heading>
      <Field fields={[{ label: "Surname", value: "Du Toit" }]} />
    </>
  ),
};

describe("the README's markup spelling compiles and renders", () => {
  test("produces the same display list as the factory form", () => {
    const viaFactory = [Heading({ children: "Part A - the declarant" }), Field({ fields: [{ label: "Surname", value: "Du Toit" }] })];
    expect(nodesOf(doc.content)).toEqual(nodesOf(viaFactory));
  });

  test("paginates as a document, with its heading set", () => {
    const pages = paginate(doc);
    expect(pages).toHaveLength(1);
    expect((pages[0]?.nodes ?? []).filter((node) => node.kind === "text").map((node) => node.run)).toContain("PART A - THE DECLARANT");
  });

  test("nests, so a component's children arrive lowered", () => {
    const nested = (
      <>
        <Heading level={2}>Contact</Heading>
        <Field fields={[{ label: "Email", value: "a@b.example" }]} />
      </>
    );
    expect(nodesOf(nested)).toEqual(
      nodesOf([Heading({ level: 2, children: "Contact" }), Field({ fields: [{ label: "Email", value: "a@b.example" }] })]),
    );
  });
});
