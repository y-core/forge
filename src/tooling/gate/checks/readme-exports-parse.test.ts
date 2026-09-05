import { describe, expect, it } from "bun:test";

import {
  type ImportPathAnchor,
  parseExportsHeadingLine,
  parseExportsTableSymbols,
  parseImportPathAnchors,
  parseTypesProse,
} from "./readme-exports-parse";

const README = [
  "# Title", // 1
  "", // 2
  "## `@y-core/forge/ui/core`", // 3
  "", // 4
  "> Import path: `@y-core/forge/ui/core` → `src/ui/core/mod.ts`", // 5
  "> **SSR only.**", // 6
  "", // 7
  "### Exports", // 8
  "", // 9
  "| Export | Renders | Notes |", // 10
  "| ------ | ------- | ----- |", // 11
  "| `Form` | `<form>` | Passes HTMX attributes through. |", // 12
  "| `Select.Option`, `stateAttrs(state)` | misc | Two names in one cell. |", // 13
  "| `cn`, `utilityOf`, `cva` | class utilities | Three. |", // 14
  "", // 15
  "Prose after the table.", // 16
  "", // 17
  "**Types:** `ButtonProps`, `ForgeIcon<Name>`,", // 18
  "`GlyphEntry` (`{ viewBox, markup }`), `Scale<T>`.", // 19
  "", // 20
  "## `@y-core/forge/ui/core/client`", // 21
  "", // 22
  "> Import path: `@y-core/forge/ui/core/client` → `src/ui/core/client.ts`", // 23
  "> **Browser-only, side-effect import.** No exports.", // 24
  "", // 25
  "Nothing to document.", // 26
].join("\n");

describe("parseImportPathAnchors() — the line a section opts in with", () => {
  it("reads every anchor with the span of the section it opens", () => {
    expect(parseImportPathAnchors(README)).toEqual([
      { subpath: "./ui/core", barrel: "src/ui/core/mod.ts", line: 5, sectionStart: 3, sectionEnd: 21 },
      { subpath: "./ui/core/client", barrel: "src/ui/core/client.ts", line: 23, sectionStart: 21, sectionEnd: 27 },
    ] satisfies ImportPathAnchor[]);
  });

  it("drops the package name from a bare specifier as well as a scoped one", () => {
    expect(parseImportPathAnchors("> Import path: `forge/ui/core` → `src/ui/core/mod.ts`")).toEqual([
      { subpath: "./ui/core", barrel: "src/ui/core/mod.ts", line: 1, sectionStart: 1, sectionEnd: 2 },
    ]);
  });

  it("reads nothing from a README carrying no anchor", () => {
    expect(parseImportPathAnchors("# Title\n\nSome prose about `@y-core/forge/ui/core`.\n")).toEqual([]);
  });
});

describe("parseExportsHeadingLine() — where a rule-1 finding is reported", () => {
  it("finds the heading inside the section", () => {
    expect(parseExportsHeadingLine(README, 3, 21)).toBe(8);
  });

  it("answers null for a section with no table", () => {
    expect(parseExportsHeadingLine(README, 21, 27)).toBe(null);
  });
});

describe("parseExportsTableSymbols() — cell 1 of every body row", () => {
  it("reduces each entry to its root identifier and splits a multi-symbol cell", () => {
    expect(parseExportsTableSymbols(README, 3, 21)).toEqual([
      { name: "Form", line: 12 },
      { name: "Select", line: 13 },
      { name: "stateAttrs", line: 13 },
      { name: "cn", line: 14 },
      { name: "utilityOf", line: 14 },
      { name: "cva", line: 14 },
    ]);
  });

  it("reads nothing from a section with no `### Exports`", () => {
    expect(parseExportsTableSymbols(README, 21, 27)).toEqual([]);
  });

  it("stops at the end of the first table rather than reading a later one", () => {
    const markdown = ["### Exports", "| Export |", "| --- |", "| `a` |", "", "| Other |", "| --- |", "| `b` |"].join("\n");
    expect(parseExportsTableSymbols(markdown, 1, 9)).toEqual([{ name: "a", line: 4 }]);
  });

  it("names nothing for a cell whose backticked span opens with no identifier", () => {
    const markdown = ["### Exports", "| Export |", "| --- |", "| `{ viewBox }` |"].join("\n");
    expect(parseExportsTableSymbols(markdown, 1, 5)).toEqual([]);
  });
});

describe("parseTypesProse() — the sentence a type export may be documented in instead", () => {
  it("collects the whole paragraph, wrapped lines included, and skips a shape", () => {
    expect([...parseTypesProse(README, 3, 21)].sort()).toEqual(["ButtonProps", "ForgeIcon", "GlyphEntry", "Scale"]);
  });

  it("stops at the blank line that ends the paragraph", () => {
    const markdown = ["**Types:** `Alpha`.", "", "Later prose about `Beta`."].join("\n");
    expect([...parseTypesProse(markdown, 1, 4)]).toEqual(["Alpha"]);
  });

  it("is empty for a section with no `**Types:**` sentence", () => {
    expect([...parseTypesProse(README, 21, 27)]).toEqual([]);
  });
});
