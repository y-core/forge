import { describe, expect, test } from "bun:test";

import { outlineCount, outlineItems } from "./outline";
import { sectioned } from "./structure";
import type { PdfStructureElement, PdfStructureNode } from "./types";

function head(type: string, text?: string, page = 0): PdfStructureElement {
  return { type, page, mcid: 0, ...(text === undefined ? {} : { text }) };
}

// The outline reads the sectioned tree, so a fixture is a list of leaves put through the same
// sectioning the writer uses — a hand-nested tree would be free to disagree with it.
function documentOf(leaves: readonly PdfStructureElement[]): PdfStructureNode {
  return { type: "Document", children: sectioned(leaves.map((leaf) => ({ ...leaf, children: [] }))) };
}

describe("the outline a document's heads describe", () => {
  test("takes one line per first-level head, opening the page it was set on", () => {
    const items = outlineItems(documentOf([head("H1", "Part A"), head("H1", "Part B", 1)]));
    expect(items.map((item) => [item.title, item.page])).toEqual([
      ["Part A", 0],
      ["Part B", 1],
    ]);
  });

  test("nests a second-level head under the first-level one before it", () => {
    const [part] = outlineItems(documentOf([head("H1", "Part A"), head("H2", "Contact"), head("H2", "Holding")]));
    expect(part?.children.map((child) => child.title)).toEqual(["Contact", "Holding"]);
  });

  test("a second-level head with nothing above it stands on its own rather than being dropped", () => {
    expect(outlineItems(documentOf([head("H2", "Contact")])).map((item) => item.title)).toEqual(["Contact"]);
  });

  test("leaves out everything that is not a head, so a paragraph never becomes a bookmark", () => {
    expect(outlineItems(documentOf([head("P", "A line of copy"), head("Figure", "A mark")]))).toEqual([]);
  });

  test("leaves out a head that set no words, since an untitled bookmark names nothing", () => {
    expect(outlineItems(documentOf([head("H1")]))).toEqual([]);
  });
});

describe("how many lines an open outline shows", () => {
  test("counts the nested lines as well as the ones at the top", () => {
    expect(outlineCount(outlineItems(documentOf([head("H1", "Part A"), head("H2", "Contact"), head("H1", "Part B")])))).toBe(3);
  });

  test("an outline with nothing in it shows nothing", () => {
    expect(outlineCount([])).toBe(0);
  });
});
