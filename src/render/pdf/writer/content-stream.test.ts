import { describe, expect, test } from "bun:test";

import { PAGE_HEIGHT } from "../geometry";
import type { PdfNode, PdfPage, PdfTextNode } from "../types";
import { composePdf, fontResource, operatorsFor, substitutedRun } from "./content-stream";

function pageOf(nodes: PdfNode[]): PdfPage {
  return { nodes, y: 0, letterheadNodes: 0 };
}

const RUN: PdfTextNode = { kind: "text", tag: "value", x: 0, y: 0, run: "set", face: "regular", size: 10, tracking: 0 };

describe("the y-up conversion happens in the writer and nowhere else", () => {
  test("a run's y-down baseline becomes its distance from the page's bottom edge", () => {
    const ops = operatorsFor({ kind: "text", tag: "value", x: 56, y: 100, run: "x", face: "regular", size: 10, tracking: 0 });
    expect(ops).toBe(`BT /F1 10 Tf 0 Tc 56 ${PAGE_HEIGHT - 100} Td (x) Tj ET`);
  });

  test("a line's endpoints flip together, so a horizontal rule stays horizontal", () => {
    const commands = [
      { op: "move", x: 56, y: 100 },
      { op: "line", x: 539, y: 100 },
    ] as const;
    expect(operatorsFor({ kind: "path", tag: "rule", commands, paint: "stroke", weight: 0.5 })).toBe("0.5 w 56 742 m 539 742 l S");
  });

  test("a top-anchored rectangle becomes a bottom-anchored one of the same height", () => {
    const commands = [{ op: "rect", x: 10, y: 100, width: 8, height: 30 }] as const;
    expect(operatorsFor({ kind: "path", tag: "artwork", commands })).toBe("10 712 8 30 re f");
  });
});

// A band is laid out once, so the page it lands on is only settled when the file is emitted — which
// is the one thing the writer knows that layout did not.
describe("a placeholder resolves against the page it landed on", () => {
  test("sets a page number as its one-based position, and a count as the total", () => {
    const at = { index: 2, count: 9 };
    expect(substitutedRun({ ...RUN, placeholder: "page-number" }, at)).toBe("3");
    expect(substitutedRun({ ...RUN, placeholder: "page-count" }, at)).toBe("9");
  });

  test("leaves a run carrying no placeholder exactly as layout wrote it", () => {
    expect(substitutedRun(RUN, { index: 2, count: 9 })).toBe("set");
  });
});

// A hash of the face's own name collides, and the loser's runs then draw in the winner's glyphs
// with nothing in the file disclosing it.
describe("an embedded face is addressed by where it sits in the document's fonts", () => {
  test("names each position distinctly, so no two faces can share a resource", () => {
    expect([fontResource(0), fontResource(1), fontResource(2)]).toEqual(["E0", "E1", "E2"]);
  });
});

describe("what composition settles before a byte is written", () => {
  test("keeps the base-14 pair for a document that embeds nothing, so an unfonted render is stable", () => {
    expect(composePdf([pageOf([RUN])]).writesBase14).toBe(true);
  });

  test("builds one content stream per page, in document order", () => {
    expect(composePdf([pageOf([RUN]), pageOf([RUN])]).streams).toHaveLength(2);
  });

  test("leaves an untagged document with no marked-content brackets in its stream", () => {
    expect(composePdf([pageOf([RUN])]).streams[0]).not.toContain("BDC");
  });
});
