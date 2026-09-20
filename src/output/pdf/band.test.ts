import { describe, expect, test } from "bun:test";

import { Stack, PageBreak, PageNumber, Text } from "./components";
import { Field } from "./form";
import { BLANK_LEAD, LINE, VALUE_SIZE } from "./geometry";
import { DEFAULT_PDF_MAX_PAGES } from "./limits";
import { pdfContentBox, resolvePdfPage } from "./page";
import { paginate } from "./paginate";
import { createPdfRenderer } from "./renderer";
import { textWidth } from "./text";
import type { PdfContent, PdfDocument, PdfElement, PdfNode } from "./types";
import { operatorsFor } from "./writer";

const PAPER = resolvePdfPage();
const CONTENT = pdfContentBox(PAPER);
const decoder = new TextDecoder("latin1");

function rows(count: number): PdfElement[] {
  return Array.from({ length: count }, () => Field({ fields: [{ label: "Surname", value: "Du Toit" }] }));
}

function runsOf(nodes: readonly PdfNode[]): string[] {
  return nodes.filter((node) => node.kind === "text").map((node) => node.run);
}

function documentOf(over: Partial<PdfDocument>, content: PdfContent = rows(60)): PdfDocument {
  return { title: "Declaration", content, ...over };
}

describe("a band is laid out once and repeated on every page", () => {
  test("a header appears on every page a long document reaches", () => {
    const pages = paginate(documentOf({ header: Text({ children: "Confidential" }) }));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(runsOf(page.nodes)).toContain("Confidential");
  });

  test("a footer appears on every page, including the last", () => {
    const pages = paginate(documentOf({ footer: Text({ children: "Page footer" }) }));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(runsOf(page.nodes)).toContain("Page footer");
  });

  test("a band sits outside the flowing content, so content stops above the footer", () => {
    const withFooter = paginate(documentOf({ footer: Text({ children: "f" }) }));
    const without = paginate(documentOf({}));
    // `label` is a content-only tag, so the footer's own run cannot answer this question for itself.
    const lowestLabel = (pages: ReturnType<typeof paginate>): number =>
      Math.max(
        ...pages.flatMap((page) =>
          page.nodes
            .filter((node) => node.kind === "text")
            .filter((node) => node.tag === "label")
            .map((node) => node.y),
        ),
      );
    expect(lowestLabel(withFooter)).toBeLessThan(lowestLabel(without));
  });

  test("a document with no bands is unchanged by the feature", () => {
    expect(paginate(documentOf({}))).toHaveLength(paginate(documentOf({ header: null, footer: null })).length);
  });
});

describe("PageNumber is a placeholder the writer substitutes", () => {
  const doc = documentOf({ footer: Stack({ children: [PageNumber()] }) }, [...rows(4), PageBreak(), ...rows(4)]);

  test("carries no page number of its own in the display list", () => {
    const [first] = paginate(doc);
    const node = (first?.nodes ?? []).find((one) => one.kind === "text" && one.placeholder === "page-number");
    expect(node).toBeDefined();
    expect(node?.kind === "text" ? node.run : "").toBe("0".repeat(String(DEFAULT_PDF_MAX_PAGES).length));
  });

  test("renders each page's own number as the writer emits it", () => {
    const node = paginate(doc)[0]?.nodes.find((one) => one.kind === "text" && one.placeholder === "page-number");
    expect(node).toBeDefined();
    if (node === undefined) return;
    expect(operatorsFor(node, PAPER.height, { index: 0, count: 2 })).toContain("(1) Tj");
    expect(operatorsFor(node, PAPER.height, { index: 1, count: 2 })).toContain("(2) Tj");
  });

  test("renders the document's page count where `total` asks for it", () => {
    const node = paginate(documentOf({ footer: PageNumber({ total: true }) }))[0]?.nodes.find(
      (one) => one.kind === "text" && one.placeholder === "page-count",
    );
    expect(node).toBeDefined();
    if (node === undefined) return;
    expect(operatorsFor(node, PAPER.height, { index: 0, count: 12 })).toContain("(12) Tj");
  });

  test("reserves the width of the widest number it could become, not of the one it currently shows", () => {
    const reserved = PageNumber().measure(CONTENT.width).preferred;
    expect(reserved).toBeCloseTo(textWidth("0".repeat(String(DEFAULT_PDF_MAX_PAGES).length), VALUE_SIZE), 9);
    expect(reserved).toBeGreaterThan(textWidth("1", VALUE_SIZE));
  });

  test("measures the same whether the substituted number has one digit or two", () => {
    const element = PageNumber();
    const [node] = paginate(documentOf({ footer: element }, rows(4))).map((page) =>
      page.nodes.filter((one) => one.kind === "text").find((one) => one.placeholder === "page-number"),
    );
    expect(node).toBeDefined();
    if (node === undefined) return;
    const widthOf = (count: number): number => operatorsFor(node, PAPER.height, { index: count - 1, count }).length;
    expect(node.x).toBe(node.x);
    expect(operatorsFor(node, PAPER.height, { index: 0, count: 9 })).toContain("(1) Tj");
    expect(operatorsFor(node, PAPER.height, { index: 9, count: 10 })).toContain("(10) Tj");
    // The `Td` operands are the reserved position, and they do not move with the digit count.
    const positionOf = (ops: string): string => (/Td/.exec(ops) === null ? "" : ops.slice(0, ops.indexOf(" Td")));
    expect(positionOf(operatorsFor(node, PAPER.height, { index: 0, count: 9 }))).toBe(
      positionOf(operatorsFor(node, PAPER.height, { index: 9, count: 10 })),
    );
    expect(widthOf(9)).toBeLessThanOrEqual(widthOf(10));
  });

  test("reserves more room where the caller raised the ceiling", () => {
    expect(PageNumber({ digits: 4 }).measure(CONTENT.width).preferred).toBeGreaterThan(PageNumber({ digits: 2 }).measure(CONTENT.width).preferred);
  });

  test("numbers a rendered document from single into double digits", async () => {
    const rendered = await createPdfRenderer({ compress: false }).render(documentOf({ footer: PageNumber() }, rows(400)));
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const out = decoder.decode(rendered.data);
    const count = Number(/\/Count (\d+)/.exec(out)?.[1]);
    expect(count).toBeGreaterThan(9);
    expect(out).toContain("(9) Tj");
    expect(out).toContain("(10) Tj");
  });
});

describe("a letterhead document breaks where the content box actually ends", () => {
  const MARK = { name: "Meridian", tagline: "Practice", email: "a@b.example", phone: "+27 21 555 0143" };

  function lowestLabelOnAFullPage(doc: PdfDocument): number {
    const pages = paginate(doc);
    expect(pages.length).toBeGreaterThan(1);
    const full = pages.slice(0, -1);
    return Math.max(
      ...full.flatMap((page) =>
        page.nodes
          .filter((node) => node.kind === "text")
          .filter((node) => node.tag === "label")
          .map((node) => node.y),
      ),
    );
  }

  // The gap is one row at most, because the row that would have followed is what did not fit. The
  // regression this pins left the whole letterhead block's height of the page unused instead.
  test("uses the whole page, rather than stopping a letterhead's height early", () => {
    const lowest = lowestLabelOnAFullPage(documentOf({ letterhead: MARK }, rows(200)));
    expect(CONTENT.bottom - lowest).toBeLessThan(LINE + BLANK_LEAD);
  });

  test("reaches the same depth with a letterhead as without one", () => {
    const withMark = lowestLabelOnAFullPage(documentOf({ letterhead: MARK }, rows(200)));
    const without = lowestLabelOnAFullPage(documentOf({}, rows(200)));
    expect(Math.abs(withMark - without)).toBeLessThanOrEqual(LINE);
  });

  test("gives up exactly the footer's room, and no more", () => {
    const footed = lowestLabelOnAFullPage(documentOf({ letterhead: MARK, footer: Text({ children: "f" }) }, rows(200)));
    expect(CONTENT.bottom - footed).toBeLessThan(LINE * 3);
    expect(footed).toBeLessThan(CONTENT.bottom);
  });
});
