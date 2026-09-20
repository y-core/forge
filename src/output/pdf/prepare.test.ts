import { describe, expect, test } from "bun:test";

import { PageBreak, Stack, Text } from "./components";
import { Field } from "./form";
import { DEFAULT_PDF_MAX_PAGES, LINK_SCHEMES } from "./limits";
import { Link } from "./link";
import { preparePdfRender } from "./prepare";
import type { PdfDocument, PdfElement } from "./types";

function documentOf(breaks: number): PdfDocument {
  const row = (): PdfElement => Field({ fields: [{ label: "Surname", value: "Du Toit" }] });
  const content: PdfElement[] = [row()];
  for (let at = 0; at < breaks; at += 1) content.push(PageBreak(), row());
  return { title: "Declaration", content };
}

describe("a document and its options settle to the pages they lay out to", () => {
  test("answers the paginated pages and the paper they were laid out on", () => {
    const prepared = preparePdfRender(documentOf(2), {});
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.data.pages).toHaveLength(3);
    expect(prepared.data.paper.width).toBeGreaterThan(0);
  });

  test("lays out on the paper the options name rather than on the default", () => {
    const prepared = preparePdfRender(documentOf(0), { page: { size: "a5" } });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.data.paper.width).toBeLessThan(500);
  });
});

// The order matters as much as the refusals do: the character check runs over the pages laid out, so
// it wins for every character reached — a ceiling forbidding the page carrying one leaves no run.
describe("every refusal a render answers with, in the order it meets them", () => {
  test("refuses a character the base-14 faces cannot set, by the code point itself", () => {
    const doc: PdfDocument = { title: "Declaration", content: [Field({ fields: [{ label: "Name", value: "Du Toit 価" }] })] };
    const prepared = preparePdfRender(doc, {});
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error.kind).toBe("encoding");
    expect(prepared.error.message).toContain("U+4FA1");
  });

  test("refuses a document over the page ceiling, naming the ceiling it was held to", () => {
    const prepared = preparePdfRender(documentOf(4), { maxPages: 2 });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error.kind).toBe("max-pages");
    expect(prepared.error.message).toContain("2-page ceiling");
  });

  test("holds a document to DEFAULT_PDF_MAX_PAGES where the caller names no ceiling", () => {
    const prepared = preparePdfRender(documentOf(DEFAULT_PDF_MAX_PAGES + 1), {});
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error.message).toContain(`${DEFAULT_PDF_MAX_PAGES}-page ceiling`);
  });

  test("takes a document exactly at the ceiling, which is the boundary an off-by-one moves", () => {
    expect(preparePdfRender(documentOf(2), { maxPages: 3 }).ok).toBe(true);
  });

  test("meets the unsettable character before the ceiling, over the pages it did lay out", () => {
    const doc: PdfDocument = { title: "Declaration", content: [Field({ fields: [{ label: "Name", value: "価" }] })] };
    const prepared = preparePdfRender(doc, { maxPages: 1 });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error.kind).toBe("encoding");
  });

  test("answers the ceiling where it forbids laying out the character in the first place", () => {
    const doc: PdfDocument = { title: "Declaration", content: [Field({ fields: [{ label: "Name", value: "価" }] })] };
    const prepared = preparePdfRender(doc, { maxPages: 0 });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error.kind).toBe("max-pages");
  });
});

describe("a link target is judged by its scheme, since a PDF annotation is what a reader opens", () => {
  const linking = (uri: string): PdfDocument => ({
    title: "Declaration",
    content: [Stack({ children: [Link({ to: { uri }, children: [Text({ children: "Terms" })] })] })],
  });

  for (const uri of ["https://example.org/terms", "http://example.org", "mailto:clerk@example.org"]) {
    test(`takes \`${uri}\`, which is one of the schemes a link may target`, () => {
      expect(preparePdfRender(linking(uri), {}).ok).toBe(true);
    });
  }

  for (const uri of ["javascript:alert(1)", "file:///etc/passwd", "example.org/terms"]) {
    test(`refuses \`${uri}\` by name rather than writing it into an annotation`, () => {
      const prepared = preparePdfRender(linking(uri), {});
      expect(prepared.ok).toBe(false);
      if (prepared.ok) return;
      expect(prepared.error.kind).toBe("link");
      expect(prepared.error.message).toContain(uri);
    });
  }

  // The allowlist is published on `./output/pdf`, so anything sharing the isolate reaches it. A
  // `const` binding would still have let a push widen the guard for every later render.
  test("cannot be widened from outside: pushing to the exported list refuses the target still", () => {
    expect(() => (LINK_SCHEMES as string[]).push("javascript")).toThrow();
    expect(LINK_SCHEMES).toEqual(["http", "https", "mailto"]);
    expect(preparePdfRender(linking("javascript:alert(1)"), {}).ok).toBe(false);
  });

  test("says nothing about a destination inside the document, which carries no scheme at all", () => {
    const doc: PdfDocument = {
      title: "Declaration",
      content: [Stack({ children: [Link({ to: { page: 0 }, children: [Text({ children: "Part B" })] })] })],
    };
    expect(preparePdfRender(doc, {}).ok).toBe(true);
  });
});
