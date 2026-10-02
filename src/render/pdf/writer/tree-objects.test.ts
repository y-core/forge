import { describe, expect, test } from "bun:test";

import type { PdfLink, PdfNode, PdfOutlineItem, PdfPage, PdfStructureNode } from "../types";
import { createObjectManager } from "./objects";
import { annotObject, linkLeaves, outlineFor, pageIsTransparent, structureTree } from "./tree-objects";

const HEIGHT = 800;
const pageId = (index: number): number => 10 + index;

function pageOf(nodes: PdfNode[]): PdfPage {
  return { nodes, y: 0, letterheadNodes: 0 };
}

function leaf(type: string, over: Partial<PdfStructureNode> = {}): PdfStructureNode {
  return { type, children: [], ...over };
}

const EXTERNAL: PdfLink = { x: 10, y: 20, width: 100, height: 12, target: { uri: "https://example.org/terms" } };

// PDF/A does not forbid transparency, it forbids *undeclared* transparency — so this decides
// whether a page has to name a blending colour space, not whether it may.
describe("whether a page draws anything an archival file must declare a blend space for", () => {
  test("finds a translucent ink, a translucent image and a shaded path", () => {
    expect(pageIsTransparent(pageOf([{ kind: "ink", tag: "artwork", channel: "fill", ink: [0, 0, 0, 0.5] }]))).toBe(true);
    expect(pageIsTransparent(pageOf([{ kind: "image", tag: "artwork", x: 0, y: 0, width: 1, height: 1, image: {} as never, alpha: 0.5 }]))).toBe(
      true,
    );
    expect(pageIsTransparent(pageOf([{ kind: "path", tag: "artwork", commands: [], shading: {} as never }]))).toBe(true);
  });

  test("says no for a page of solid ink, so a file of solid inks declares nothing it does not need", () => {
    expect(pageIsTransparent(pageOf([{ kind: "ink", tag: "artwork", channel: "fill", ink: [0, 0, 0] }]))).toBe(false);
  });
});

describe("a link annotation", () => {
  test("flips its rectangle into user space, so it sits over the run it describes", () => {
    expect(annotObject(EXTERNAL, HEIGHT, pageId)).toContain(`/Rect [10 ${HEIGHT - 32} 110 ${HEIGHT - 20}]`);
  });

  // `/Border [0 0 0]` is what stops a viewer drawing its own rectangle over a run already set to
  // read as a link: the annotation is the behaviour, not the appearance.
  test("declares no border of its own, and the flags a reachable annotation needs", () => {
    expect(annotObject(EXTERNAL, HEIGHT, pageId)).toContain("/Border [0 0 0] /F 4");
  });

  test("writes an address as a URI action and a page target as a destination", () => {
    expect(annotObject(EXTERNAL, HEIGHT, pageId)).toContain("/A << /S /URI /URI (https://example.org/terms) >>");
    expect(annotObject({ ...EXTERNAL, target: { page: 2 } }, HEIGHT, pageId)).toContain(`/Dest [${pageId(2)} 0 R /Fit]`);
  });

  // An `/OBJR` is a forward edge only, so the annotation names its own key — it is how a reader who
  // tabbed to a link walks back to the element describing it.
  test("names its structure key and its contents only when it was given them", () => {
    expect(annotObject(EXTERNAL, HEIGHT, pageId, 7, "The terms")).toContain("/StructParent 7");
    expect(annotObject(EXTERNAL, HEIGHT, pageId)).not.toContain("/StructParent");
    expect(annotObject(EXTERNAL, HEIGHT, pageId)).not.toContain("/Contents");
  });
});

describe("finding the tree's link leaves", () => {
  test("reaches a link nested under anything, and stops at the link itself", () => {
    const nested = leaf("Document", { children: [leaf("P", { children: [leaf("Link", { link: 0 })] }), leaf("Link", { link: 1 })] });
    expect(linkLeaves(nested).map((node) => node.link)).toEqual([0, 1]);
  });

  test("answers nothing for a tree carrying no link at all", () => {
    expect(linkLeaves(leaf("Document", { children: [leaf("P")] }))).toEqual([]);
  });
});

describe("the structure tree as objects", () => {
  const DOCUMENT = leaf("Document", { children: [leaf("P", { page: 0, mcid: 0 })] });

  test("names its root, declares the document marked, and carries the language it was given", () => {
    const entries = structureTree(createObjectManager(), [pageOf([])], pageId, { lang: "en-ZA" }, [[]], DOCUMENT, [[]]);
    expect(entries).toContain("/MarkInfo << /Marked true >>");
    expect(entries).toContain("/Lang (en-ZA)");
    expect(entries).toContain("/ViewerPreferences << /DisplayDocTitle true >>");
  });

  // A parent names its children and a child its parent, so neither body can be written before the
  // other — every node takes its number in one pass and is filled in a second.
  test("fills every object it reserved, leaving no placeholder body behind", () => {
    const manager = createObjectManager();
    structureTree(manager, [pageOf([])], pageId, { lang: "en" }, [[]], DOCUMENT, [[]]);
    expect(manager.objects().filter((object) => object.body === "<< >>")).toEqual([]);
  });

  test("reserves the next parent-tree key past the pages and the annotations together", () => {
    const manager = createObjectManager();
    structureTree(manager, [pageOf([]), pageOf([])], pageId, { lang: "en" }, [[]], DOCUMENT, [[5], [6, 7]]);
    const root = manager.objects().find((object) => String(object.body).includes("/StructTreeRoot"));
    expect(String(root?.body)).toContain("/ParentTreeNextKey 5");
  });
});

describe("the outline as objects", () => {
  const ITEMS: readonly PdfOutlineItem[] = [
    { title: "One", page: 0, children: [{ title: "One a", page: 1, children: [] }] },
    { title: "Two", page: 2, children: [] },
  ];

  test("names its root and asks a viewer to open on it", () => {
    expect(outlineFor(createObjectManager(), ITEMS, pageId)).toContain("/PageMode /UseOutlines");
  });

  test("writes nothing at all for a document with no heads, rather than an empty outline", () => {
    const manager = createObjectManager();
    expect(outlineFor(manager, [], pageId)).toBe("");
    expect(manager.objects()).toEqual([]);
  });

  // An item names the item before and after it as well as its parent, which is what a viewer walks.
  test("links siblings both ways and leaves the ends open", () => {
    const manager = createObjectManager();
    outlineFor(manager, ITEMS, pageId);
    const bodies = manager.objects().map((object) => String(object.body));
    expect(bodies.some((body) => body.includes("/Title (One)") && body.includes("/Next") && !body.includes("/Prev"))).toBe(true);
    expect(bodies.some((body) => body.includes("/Title (Two)") && body.includes("/Prev") && !body.includes("/Next"))).toBe(true);
  });
});
