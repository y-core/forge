import { describe, expect, test } from "bun:test";

import { Text } from "./components";
import { createCursor } from "./cursor";
import { place } from "./elements";
import { MARGIN, PAGE_WIDTH } from "./geometry";
import { Path } from "./graphics";
import { Link } from "./link";
import { createPdfPen } from "./path";
import { createPdfRenderer } from "./renderer";
import type { PdfBox, PdfDocument, PdfElement, PdfLink, PdfPage } from "./types";

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

  test("declares the children it wraps, so a drawing inside it is still reachable by an audit", () => {
    const inside = Text({ children: "The full terms" });
    expect(Link({ to: { uri: "https://example.org" }, children: [inside] }).children).toEqual([inside]);
  });

  // The defect this closes: the index was taken before the draw and the annotation pushed after, so
  // an inner link pushed first and took it, leaving the outer's nodes pointing at the inner.
  test("a link inside a link binds each run to its own annotation, not to the other's", () => {
    const inner = Link({ to: { uri: "https://example.org/inner" }, children: [Text({ children: "inner" })] });
    const outer = Link({ to: { uri: "https://example.org/outer" }, children: [Text({ children: "outer" })] });
    const [page] = pagesOf(Link({ to: { uri: "https://example.org/wrapper" }, children: [outer, inner] }));
    const links = page?.links ?? [];
    const texts = (page?.nodes ?? []).filter((node) => node.kind === "text");
    for (const node of texts) {
      expect(links[node.link ?? -1]?.target).toEqual({ uri: `https://example.org/${node.run}` });
    }
  });

  test("a run that breaks across pages is activated on each, where that piece actually landed", () => {
    const long = Array.from({ length: 1200 }, (_word, at) => `word${at}`).join(" ");
    const pages = pagesOf(Link({ to: { uri: "https://example.org" }, children: [Text({ children: long })] }));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => (page.links ?? []).length > 0)).toBe(true);
  });
});

describe("a link annotation is reachable from the tree and printable by PDF/A", () => {
  const LINKED: PdfDocument = {
    title: "Declaration",
    content: [Link({ to: { uri: "https://example.test/terms" }, children: [Text({ children: "the terms of this declaration" })] })],
  };

  async function taggedText(doc: PdfDocument): Promise<string> {
    const rendered = await createPdfRenderer({ tagged: true, compress: false }).render(doc);
    if (!rendered.ok) throw new Error(rendered.error.message);
    return new TextDecoder("latin1").decode(rendered.data);
  }

  test("sets Print and clears Hidden, Invisible and NoView", async () => {
    expect(await taggedText(LINKED)).toContain("/F 4");
  });

  test("carries the link's own words, which is where a reader tabbing to it is told what it is", async () => {
    expect(await taggedText(LINKED)).toContain("/Contents (the terms of this declaration)");
  });

  test("names its own key, and that key resolves through the parent tree to its own element", async () => {
    const text = await taggedText(LINKED);
    const key = Number(/\/StructParent (\d+)/.exec(text)?.[1]);
    expect(key).toBeGreaterThanOrEqual(1);
    // A single reference rather than an array: an annotation has exactly one element that owns it.
    const nums = /\/Nums \[([\S\s]*?)\] >>/.exec(text)?.[1] ?? "";
    const element = Number(new RegExp(String.raw`\] ${key} (\d+) 0 R`).exec(nums)?.[1]);
    const bodies = new Map([...text.matchAll(/(\d+) 0 obj\n([\S\s]*?)\nendobj/g)].map((found) => [Number(found[1]), found[2] ?? ""]));
    expect(bodies.get(element)).toContain("/S /Link");
  });

  test("declares a next key past every key it issued, and puts tab order on the structure", async () => {
    const text = await taggedText(LINKED);
    const next = Number(/\/ParentTreeNextKey (\d+)/.exec(text)?.[1]);
    const keys = [...text.matchAll(/\/StructParents? (\d+)/g)].map((found) => Number(found[1]));
    expect(Math.max(...keys)).toBeLessThan(next);
    expect(text).toContain("/Tabs /S");
  });

  test("a link broken across two pages gives two annotations with distinct keys", async () => {
    const long = "the terms of this declaration and every schedule annexed to it ".repeat(12);
    const text = await taggedText({
      title: "Declaration",
      content: [
        ...Array.from({ length: 44 }, () => Text({ children: "A line of the declaration." })),
        Link({ to: { uri: "https://example.test/terms" }, children: [Text({ children: long })] }),
      ],
    });
    const keys = [...text.matchAll(/\/StructParent (\d+)/g)].map((found) => Number(found[1]));
    expect(keys.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// The defect this closes: a link wrapping a drawing paints no text, so an index over texted leaves
// alone slipped by one and handed that annotation the next link's words.
describe("a link that wraps no words takes no other link's words", () => {
  const commands = createPdfPen().move(0, 0).line(40, 0).close().commands();

  async function bothLinks(first: "drawing" | "words"): Promise<string> {
    const drawing = Link({ to: { uri: "https://example.org/mark" }, children: [Path({ commands, height: 20, stroke: [0, 0, 0] })] });
    const words = Link({ to: { uri: "https://example.org/terms" }, children: [Text({ children: "Terms of use" })] });
    const rendered = await createPdfRenderer({ tagged: true, compress: false }).render({
      title: "Declaration",
      content: first === "drawing" ? [drawing, words] : [words, drawing],
    });
    if (!rendered.ok) throw new Error(rendered.error.message);
    return new TextDecoder("latin1").decode(rendered.data);
  }

  test("gives each annotation its own words or none, in either order", async () => {
    for (const first of ["drawing", "words"] as const) {
      const text = await bothLinks(first);
      const annots = [...text.matchAll(/<< \/Type \/Annot[^\n]*/g)].map((found) => found[0]);
      expect(annots).toHaveLength(2);
      const mark = annots.find((annot) => annot.includes("/mark")) ?? "";
      const terms = annots.find((annot) => annot.includes("/terms")) ?? "";
      expect(mark).not.toContain("/Contents");
      expect(terms).toContain("/Contents (Terms of use)");
    }
  });

  test("resolves every key it issued through /Nums, whether or not the drawing is described", async () => {
    for (const first of ["drawing", "words"] as const) {
      const text = await bothLinks(first);
      const nums = /\/Nums \[([\S\s]*?)\] >>/.exec(text)?.[1] ?? "";
      const bodies = new Map([...text.matchAll(/(\d+) 0 obj\n([\S\s]*?)\nendobj/g)].map((found) => [Number(found[1]), found[2] ?? ""]));
      const keys = [...text.matchAll(/\/StructParent (\d+)/g)].map((found) => Number(found[1]));
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) {
        const element = Number(new RegExp(String.raw`(?:\]|R) ${key} (\d+) 0 R`).exec(nums)?.[1]);
        expect(bodies.get(element)).toContain("/S /Link");
      }
    }
  });
});
