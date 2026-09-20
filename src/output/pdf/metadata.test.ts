import { describe, expect, test } from "bun:test";

import { Field, Note } from "./form";
import { fileIdentifier, infoDictionary, pdfDate } from "./metadata";
import { createPdfRenderer } from "./renderer";
import type { PdfDocument } from "./types";

const decoder = new TextDecoder("latin1");

const DOC: PdfDocument = { title: "Declaration", content: [Field({ fields: [{ label: "Surname", value: "Du Toit" }] })] };

const INFO = {
  title: "Declaration of interest",
  author: "Meridian Attorneys",
  subject: "FICA section 21",
  creator: "forge",
  created: new Date(Date.UTC(2026, 8, 19, 14, 5, 3)),
};

async function bytesOf(options: Parameters<typeof createPdfRenderer>[0]): Promise<string> {
  const rendered = await createPdfRenderer(options).render(DOC);
  if (!rendered.ok) throw new Error(rendered.error.message);
  return decoder.decode(rendered.data);
}

describe("pdfDate", () => {
  test("writes PDF's own literal, in UTC so a render is not timezone-dependent", () => {
    expect(pdfDate(new Date(Date.UTC(2026, 8, 19, 14, 5, 3)))).toBe("D:20260919140503Z");
  });

  test("pads every field, so a January render is not a different length from a December one", () => {
    expect(pdfDate(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe("D:20260101000000Z");
  });
});

describe("infoDictionary", () => {
  test("writes only the fields the caller gave", () => {
    const written = infoDictionary({ title: "A", author: "B" });
    expect(written).toBe("<< /Title (A) /Author (B) >>");
  });

  test("defaults each date to the other, so one date does not leave the pair half-written", () => {
    const written = infoDictionary({ created: new Date(Date.UTC(2026, 8, 19, 0, 0, 0)) });
    expect(written).toContain("/CreationDate (D:20260919000000Z)");
    expect(written).toContain("/ModDate (D:20260919000000Z)");
  });

  test("escapes a value, so a title with a bracket cannot close the literal", () => {
    expect(infoDictionary({ title: "A (draft)" })).toBe("<< /Title (A \\(draft\\)) >>");
  });

  test("is nothing at all where the caller named no field", () => {
    expect(infoDictionary({})).toBeUndefined();
    expect(infoDictionary(undefined)).toBeUndefined();
  });
});

describe("the file identifier is derived, never random", () => {
  test("both halves are equal, since the second differs only after an incremental update", async () => {
    const id = await fileIdentifier("some material");
    const [first, second] = id.slice(1, -1).split(" ");
    expect(first).toBe(second ?? "");
    expect(first).toMatch(/^<[\da-f]{32}>$/);
  });

  test("the same material gives the same identifier, and different material a different one", async () => {
    expect(await fileIdentifier("a")).toBe(await fileIdentifier("a"));
    expect(await fileIdentifier("a")).not.toBe(await fileIdentifier("b"));
  });
});

describe("metadata in a rendered file", () => {
  test('`metadata: "standard"` writes /Info and /ID into the trailer', async () => {
    const out = await bytesOf({ metadata: "standard", info: INFO, compress: false });
    expect(out).toContain("/Title (Declaration of interest)");
    expect(out).toContain("/Author (Meridian Attorneys)");
    expect(out).toMatch(/\/ID \[<[\da-f]{32}> <[\da-f]{32}>\]/);
  });

  test('`metadata: "none"` omits the dictionary and the identifier alike, carrying none of the caller\'s `info`', async () => {
    const out = await bytesOf({ metadata: "none", info: INFO, compress: false });
    expect(out).not.toContain("/Info");
    expect(out).not.toContain("/ID");
    expect(out).not.toContain("Meridian Attorneys");
  });

  test("two renders of one document are byte-identical, compressed or not", async () => {
    for (const compress of [true, false]) {
      const options = { metadata: "standard" as const, info: INFO, compress };
      expect(await bytesOf(options)).toBe(await bytesOf(options));
    }
  });

  test("/ID is hashed over the uncompressed material, so it survives a change of filter", async () => {
    const idOf = (out: string): string => /\/ID (\[[^\]]+\])/.exec(out)?.[1] ?? "";
    const compressed = await bytesOf({ metadata: "standard", info: INFO, compress: true });
    const plain = await bytesOf({ metadata: "standard", info: INFO, compress: false });
    expect(idOf(compressed)).toBe(idOf(plain));
  });
});

// A dictionary entry is a text string rather than a page run: it is written as UTF-16BE the moment
// it leaves ASCII, so what a face can set never bounds what a document can be called.
describe("metadata carries what a page run cannot", () => {
  test("a title the base-14 faces cannot set still renders, rather than being refused", async () => {
    const rendered = await createPdfRenderer({ metadata: "standard", info: { title: "価" } }).render(DOC);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(decoder.decode(rendered.data)).toContain("/Title <FEFF4FA1>");
  });

  test("every other entry is carried the same way, not only the title", async () => {
    const rendered = await createPdfRenderer({ metadata: "standard", info: { author: "価" } }).render(DOC);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(decoder.decode(rendered.data)).toContain("/Author <FEFF4FA1>");
  });

  test("a page run outside those faces is still refused, which is the check that did not move", async () => {
    const rendered = await createPdfRenderer().render({ title: "Declaration", content: [Note({ children: "価" })] });
    expect(rendered.ok).toBe(false);
    if (rendered.ok) return;
    expect(rendered.error.kind).toBe("encoding");
    expect(rendered.error.message).toContain("U+4FA1");
  });
});
