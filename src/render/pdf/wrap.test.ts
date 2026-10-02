import { describe, expect, test } from "bun:test";

import { Text } from "./components";
import { describePdfLayout } from "./layout";
import type { PdfDocument, PdfEmbeddedFont, PdfEmbeddedMetrics, PdfRendererOptions } from "./types";

// Every mark the fixture sets, at one advance, so a width in this file is a character count times a
// constant — a moved break is then readable as "one word earlier" rather than as a float.
const CORPUS = " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,";
const ADVANCE = 500;

const METRICS: PdfEmbeddedMetrics = {
  unitsPerEm: 1000,
  ascent: 800,
  descent: -200,
  bbox: [0, 0, 1000, 1000],
  advances: new Map([...CORPUS].map((character) => [character.codePointAt(0) ?? 0, ADVANCE])),
};

const FACE: PdfEmbeddedFont = {
  name: "body",
  postScriptName: "Body",
  sfnt: new Uint8Array([0, 1, 0, 0]),
  glyphs: new Map([...CORPUS].map((character) => [character.codePointAt(0) ?? 0, 1])),
  metrics: METRICS,
};

const EMBEDDED: PdfRendererOptions = { fonts: [FACE], defaultFont: { regular: "body", bold: "body" } };

/** Every line of set body text a document lays out to, in the order the pages carry them. */
function setLines(content: PdfDocument["content"], options: PdfRendererOptions = {}): string[] {
  const described = describePdfLayout({ title: "Wrapping", content }, options);
  if (!described.ok) throw new Error(described.error.message);
  return described.data.pages.flatMap((page) =>
    page.nodes.filter((node) => node.kind === "text" && node.tag !== "title").map((node) => (node.kind === "text" ? node.text : "")),
  );
}

// The fixture `bug-260921-05` asks for: concrete break positions, committed before `Text.measure`
// was reconciled with `preferredWidth`, so the reconciliation's effect on them is a visible diff.
const ONE_LINE = "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango";

const MULTI_LINE =
  "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima\n" +
  "Mike november oscar papa quebec romeo sierra tango uniform victor whiskey\nXray";

describe("where a run breaks, set in an embedded face", () => {
  test("breaks a single-line run at the last word the measured width allows", () => {
    expect(setLines([Text({ children: ONE_LINE })], EMBEDDED)).toEqual([
      "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar",
      "papa quebec romeo sierra tango",
    ]);
  });

  // The case the defect reaches: a run whose own newlines each fit, so its lines are its breaks and
  // a preferred width that summed them would still have to leave these alone.
  test("keeps a run's own newlines as its breaks where each line fits", () => {
    expect(setLines([Text({ children: MULTI_LINE })], EMBEDDED)).toEqual([
      "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima",
      "Mike november oscar papa quebec romeo sierra tango uniform victor whiskey",
      "Xray",
    ]);
  });

  test("breaks the same run identically in the base-14 faces, where the two width paths already agreed", () => {
    expect(setLines([Text({ children: MULTI_LINE })])).toEqual(setLines([Text({ children: MULTI_LINE })], EMBEDDED));
  });
});
