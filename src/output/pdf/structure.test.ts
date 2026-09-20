import { describe, expect, test } from "bun:test";

import { markedRuns, structureElements, structureType } from "./structure";
import type { PdfNode, PdfPage, PdfTag } from "./types";

function text(tag: PdfTag): PdfNode {
  return { kind: "text", tag, x: 0, y: 0, run: "x", face: "regular", size: 10, tracking: 0 };
}

function figure(tag: PdfTag, alt?: string): PdfNode {
  return { kind: "path", tag, commands: [{ op: "close" }], ...(alt === undefined ? {} : { alt }) };
}

function pageOf(nodes: PdfNode[]): PdfPage {
  return { nodes, y: 0, letterheadNodes: 0 };
}

describe("a tag becomes the structure type PDF names for it", () => {
  test("a title is a first-level head and a section head a second-level one", () => {
    expect([structureType("title"), structureType("heading"), structureType("subtitle")]).toEqual(["H1", "H2", "H2"]);
  });

  test("copy of every kind is a paragraph, because that is what a reader announces it as", () => {
    expect(["intro", "note", "label", "value", "letterhead"].map((tag) => structureType(tag as PdfTag))).toEqual(["P", "P", "P", "P", "P"]);
  });

  test("a rule has no type at all, so it never enters the reading order", () => {
    expect(structureType("rule")).toBeUndefined();
  });
});

describe("a page's nodes group into the runs a reader announces", () => {
  test("consecutive nodes of one type are one run, so a wrapped paragraph is one thing", () => {
    const runs = markedRuns(pageOf([text("value"), text("value"), text("value")]));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ type: "P", from: 0, to: 2, mcid: 0 });
  });

  test("a change of type ends a run, and each typed run takes the next id on its page", () => {
    const runs = markedRuns(pageOf([text("title"), text("value"), text("note")]));
    expect(runs.map((run) => [run.type, run.mcid])).toEqual([
      ["H1", 0],
      ["P", 1],
      ["P", 2],
    ]);
  });

  test("a rule is an untyped run between two typed ones, and takes no id from them", () => {
    const runs = markedRuns(pageOf([text("title"), figure("rule"), text("value")]));
    expect(runs.map((run) => run.type)).toEqual(["H1", undefined, "P"]);
    expect(runs.filter((run) => run.type !== undefined).map((run) => run.mcid)).toEqual([0, 1]);
  });

  test("a figure carrying alternative text is a figure, and one without it is decoration", () => {
    expect(markedRuns(pageOf([figure("artwork", "The Meridian mark")]))[0]).toMatchObject({ type: "Figure", alt: "The Meridian mark" });
    expect(markedRuns(pageOf([figure("artwork")]))[0]?.type).toBeUndefined();
  });

  test("two figures side by side stay two runs, since each is its own thing to announce", () => {
    const runs = markedRuns(pageOf([figure("mark", "ticked"), figure("mark", "empty")]));
    expect(runs.map((run) => run.alt)).toEqual(["ticked", "empty"]);
  });
});

describe("the elements a document's pages declare", () => {
  test("names the page each element sits on, so the parent tree can be built from it", () => {
    const elements = structureElements([pageOf([text("title")]), pageOf([text("value"), text("note")])]);
    expect(elements).toEqual([
      { type: "H1", page: 0, mcid: 0, text: "x" },
      { type: "P", page: 1, mcid: 0, text: "x" },
      { type: "P", page: 1, mcid: 1, text: "x" },
    ]);
  });

  test("leaves out every artifact, which is what keeps decoration out of the tree", () => {
    expect(structureElements([pageOf([figure("rule"), figure("artwork")])])).toEqual([]);
  });

  test("carries a figure's alternative text onto its element", () => {
    expect(structureElements([pageOf([figure("mark", "crossed")])])[0]).toMatchObject({ type: "Figure", alt: "crossed" });
  });
});
