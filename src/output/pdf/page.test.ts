import { describe, expect, test } from "bun:test";

import { parsePdfText } from "./conform/parse.fixture";
import { Field } from "./form";
import { MARGIN, PAGE_HEIGHT, PAGE_WIDTH } from "./geometry";
import { pdfContentBox, PDF_PAGE_SIZES, resolvePdfPage } from "./page";
import { createPdfRenderer } from "./renderer";
import type { PdfDocument } from "./types";

const decoder = new TextDecoder("latin1");

const DOC: PdfDocument = { title: "Declaration", content: [Field({ fields: [{ label: "Surname", value: "Du Toit" }] })] };

async function mediaBoxOf(spec: Parameters<typeof resolvePdfPage>[0]): Promise<string> {
  const rendered = await createPdfRenderer({ page: spec }).render(DOC);
  if (!rendered.ok) throw new Error(rendered.error.message);
  return /\/MediaBox \[([^\]]+)\]/.exec(await parsePdfText(rendered.data))?.[1] ?? "";
}

describe("page geometry is data, not a branch inside the engine", () => {
  test("names every size it supports, so a new one is an entry rather than a code path", () => {
    expect(PDF_PAGE_SIZES).toContain("a4");
    expect(PDF_PAGE_SIZES).toContain("letter");
    expect(new Set(PDF_PAGE_SIZES).size).toBe(PDF_PAGE_SIZES.length);
  });

  test("resolves a named size to points", () => {
    expect(resolvePdfPage({ size: "a4" })).toMatchObject({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(resolvePdfPage({ size: "letter" })).toMatchObject({ width: 612, height: 792 });
  });

  test("takes an explicit point size over a named one, as the escape hatch for unlisted paper", () => {
    expect(resolvePdfPage({ size: "a4", points: [200, 400] })).toMatchObject({ width: 200, height: 400 });
  });

  test("swaps the axes for landscape, and leaves portrait as it was given", () => {
    expect(resolvePdfPage({ size: "a4", orientation: "landscape" })).toMatchObject({ width: PAGE_HEIGHT, height: PAGE_WIDTH });
    expect(resolvePdfPage({ size: "a4", orientation: "portrait" })).toMatchObject({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  });

  test("settles every margin, taking `all` for a side that says nothing", () => {
    expect(resolvePdfPage({ margin: { all: 20, left: 50 } }).margin).toEqual({ top: 20, right: 20, bottom: 20, left: 50 });
    expect(resolvePdfPage().margin).toEqual({ top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN });
  });

  test("leaves the content the room its margins do not take", () => {
    const box = pdfContentBox(resolvePdfPage({ size: "a4", margin: { top: 10, right: 20, bottom: 30, left: 40 } }));
    expect(box).toEqual({ x: 40, width: PAGE_WIDTH - 60, top: 10, bottom: PAGE_HEIGHT - 30 });
  });
});

describe("/MediaBox reflects the page it was given", () => {
  test("a named size", async () => {
    expect(await mediaBoxOf({ size: "letter" })).toBe("0 0 612 792");
  });

  test("an explicit point size", async () => {
    expect(await mediaBoxOf({ points: [300, 500] })).toBe("0 0 300 500");
  });

  test("both orientations", async () => {
    expect(await mediaBoxOf({ size: "a5", orientation: "portrait" })).toBe("0 0 420 595");
    expect(await mediaBoxOf({ size: "a5", orientation: "landscape" })).toBe("0 0 595 420");
  });

  test("asymmetric margins leave the paper alone and move the content instead", async () => {
    const asymmetric = await createPdfRenderer({ page: { margin: { top: 10, left: 90 } } }).render(DOC);
    const even = await createPdfRenderer({}).render(DOC);
    expect(asymmetric.ok && even.ok).toBe(true);
    if (!asymmetric.ok || !even.ok) return;
    expect(await mediaBoxOf({ margin: { top: 10, left: 90 } })).toBe(`0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`);
    expect(decoder.decode(asymmetric.data)).not.toBe(decoder.decode(even.data));
  });
});
