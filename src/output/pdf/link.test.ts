import { describe, expect, test } from "bun:test";

import { Text } from "./components";
import { createCursor } from "./cursor";
import { place } from "./elements";
import { MARGIN, PAGE_WIDTH } from "./geometry";
import { Link } from "./link";
import type { PdfBox, PdfElement, PdfLink, PdfPage } from "./types";

const MEASURE: PdfBox = { x: MARGIN, width: PAGE_WIDTH - MARGIN * 2, height: 700 };

function pagesOf(element: PdfElement, box: PdfBox = MEASURE): PdfPage[] {
  const cursor = createCursor(undefined);
  cursor.newPage();
  place(cursor, element, box);
  return cursor.pages;
}

function linksOf(element: PdfElement, box?: PdfBox): PdfLink[] {
  return pagesOf(element, box).flatMap((page) => page.links ?? []);
}

describe("Link", () => {
  const wrapped = (to: PdfLink["target"]): PdfElement => Link({ to, children: [Text({ children: "The full terms" })] });

  test("sets the run it wraps, and places an annotation over where that run landed", () => {
    const [page] = pagesOf(wrapped({ uri: "https://example.org/terms" }));
    expect((page?.nodes ?? []).filter((node) => node.kind === "text").map((node) => node.run)).toEqual(["The full terms"]);
    expect(page?.links).toHaveLength(1);
  });

  test("covers the width of its box, and the height the run it wraps advanced by", () => {
    const [link] = linksOf(wrapped({ uri: "https://example.org" }));
    expect(link).toMatchObject({ x: MEASURE.x, width: MEASURE.width });
    expect(link?.height).toBeGreaterThan(0);
  });

  test("carries the destination it was given, whichever kind it is", () => {
    expect(linksOf(wrapped({ page: 2 }))[0]?.target).toEqual({ page: 2 });
    expect(linksOf(wrapped({ uri: "mailto:a@b.example" }))[0]?.target).toEqual({ uri: "mailto:a@b.example" });
  });

  test("tags what it wraps as a link, which is what puts it in the structure tree as one", () => {
    const [page] = pagesOf(wrapped({ uri: "https://example.org" }));
    expect((page?.nodes ?? []).every((node) => node.tag === "link")).toBe(true);
  });

  test("a run that breaks across pages is activated on each, where that piece actually landed", () => {
    const long = Array.from({ length: 1200 }, (_word, at) => `word${at}`).join(" ");
    const pages = pagesOf(Link({ to: { uri: "https://example.org" }, children: [Text({ children: long })] }));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => (page.links ?? []).length > 0)).toBe(true);
  });
});
