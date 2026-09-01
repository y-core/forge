import { describe, expect, it } from "bun:test";

import { ESC } from "./ansi";
import { BORDERS } from "./border";
import { definitionList, renderGrid } from "./grid";

const RED = `${ESC}[31m`;
const DEFAULT_FG = `${ESC}[39m`;

describe("BORDERS", () => {
  it("marks every slot of the borderless preset zero-width, rather than a space", () => {
    expect(Object.values(BORDERS.none).map((slot) => slot.width)).toEqual(Array.from({ length: 15 }, () => 0));
  });

  it("gives the markdown preset a rule under the header and no line above it", () => {
    expect([BORDERS.markdown.topBody.width, BORDERS.markdown.joinBody.width, BORDERS.markdown.bottomBody.width]).toEqual([0, 1, 0]);
  });
});

describe("renderGrid()", () => {
  it("returns no lines for no rows", () => {
    expect(renderGrid([])).toEqual([]);
  });

  it("borders every cell and rules off the headings", () => {
    expect(renderGrid([{ Type: "kv", Binding: "MY_KV" }])).toEqual(["| Type | Binding |", "|------|---------|", "| kv   | MY_KV   |"]);
  });

  it("takes column order from the first row's keys", () => {
    expect(renderGrid([{ Z: "z", A: "a" }])[0]).toBe("| Z | A |");
  });

  it("takes column order and headings from an explicit spec", () => {
    expect(renderGrid([{ a: "1", b: "2" }], { columns: [{ key: "b", header: "Second" }, "a"] })[0]).toBe("| Second | a |");
  });

  it("drops a column that is empty in every row", () => {
    expect(renderGrid([{ Binding: "KV", "Remote ID": "" }])[0]).toBe("| Binding |");
  });

  it("keeps an all-empty column when told not to drop it", () => {
    expect(renderGrid([{ Binding: "KV", "Remote ID": "" }], { dropEmptyColumns: false })[0]).toBe("| Binding | Remote ID |");
  });

  it("returns no lines when every column is empty", () => {
    expect(renderGrid([{ Binding: "" }])).toEqual([]);
  });

  it("indents every line, rules included", () => {
    expect(renderGrid([{ Binding: "BASE_URL", Action: "deploy pushes" }], { indent: 2 })).toEqual([
      "  | Binding  | Action        |",
      "  |----------|---------------|",
      "  | BASE_URL | deploy pushes |",
    ]);
  });

  it("draws a full box under the single preset", () => {
    expect(renderGrid([{ a: "1" }], { border: BORDERS.single })).toEqual(["┌───┐", "│ a │", "├───┤", "│ 1 │", "└───┘"]);
  });

  it("separates columns by the gap when the border draws no vertical", () => {
    expect(renderGrid([{ a: "1", b: "2" }], { border: BORDERS.none, padding: 0, gap: 3, header: false })).toEqual(["1   2"]);
  });

  it("omits the headings and their rule when header is false", () => {
    expect(renderGrid([{ a: "1" }], { header: false })).toEqual(["| 1 |"]);
  });

  it("aligns a column right when asked", () => {
    expect(renderGrid([{ n: "1" }, { n: "100" }], { columns: [{ key: "n", align: "right" }] })).toEqual([
      "|   n |",
      "|-----|",
      "|   1 |",
      "| 100 |",
    ]);
  });

  it("measures a styled cell by its visible width, so the closing pipes still line up", () => {
    const lines = renderGrid([{ a: `${RED}xx${DEFAULT_FG}` }, { a: "yyyy" }], { header: false });
    expect(lines).toEqual([`| ${RED}xx${DEFAULT_FG}   |`, "| yyyy |"]);
  });

  it("wraps a wrapping column instead of overflowing maxWidth", () => {
    expect(
      renderGrid([{ k: "flag", v: "a description that will not fit" }], {
        border: BORDERS.none,
        header: false,
        padding: 0,
        gap: 2,
        maxWidth: 20,
        columns: ["k", { key: "v", wrap: true }],
      }),
    ).toEqual(["flag  a description", "      that will not", "      fit"]);
  });

  it("truncates a non-wrapping column that cannot fit", () => {
    expect(
      renderGrid([{ k: "an-extremely-long-key", v: "x" }], {
        border: BORDERS.none,
        header: false,
        padding: 0,
        gap: 2,
        maxWidth: 12,
        columns: ["k", "v"],
      }),
    ).toEqual(["an-extre…  x"]);
  });
});

describe("definitionList()", () => {
  it("returns no lines for no entries", () => {
    expect(definitionList([])).toEqual([]);
  });

  it("aligns descriptions one gap past the longest term", () => {
    expect(
      definitionList([
        { term: "previous:", description: "(none)" },
        { term: "next:", description: "1.0.0" },
        { term: "changelog:", description: "skipped" },
      ]),
    ).toEqual(["previous:   (none)", "next:       1.0.0", "changelog:  skipped"]);
  });

  it("honours the indent and the gap", () => {
    expect(
      definitionList(
        [
          { term: "previous:", description: "(none)" },
          { term: "next:", description: "1.0.0" },
          { term: "changelog:", description: "skipped" },
        ],
        { indent: 2, gap: 1 },
      ),
      // The four hard-coded paddings this replaces were `"  previous:  "` and `"  changelog: "`.
    ).toEqual(["  previous:  (none)", "  next:      1.0.0", "  changelog: skipped"]);
  });

  it("wraps a description at the given width, leaving the term column blank", () => {
    expect(definitionList([{ term: "-v, --verbose", description: "Enable verbose output for every step" }], { indent: 2, width: 40 })).toEqual([
      "  -v, --verbose  Enable verbose output",
      "                 for every step",
    ]);
  });

  it("leaves a term with no description without trailing whitespace", () => {
    expect(definitionList([{ term: "--flag", description: "" }])).toEqual(["--flag"]);
  });
});

describe("renderGrid() shrinking", () => {
  const narrow = (maxWidth: number) =>
    renderGrid([{ k: "binding-name-here", v: "a detail sentence long enough to need several lines of its own" }], {
      border: BORDERS.none,
      header: false,
      padding: 0,
      gap: 2,
      maxWidth,
      columns: ["k", { key: "v", wrap: true }],
    });

  it("takes width off the widest column rather than draining the wrapping one", () => {
    // Draining it first is what produces a column of single letters: correct arithmetic, unreadable
    // output. The two columns end up comparable instead.
    const lines = narrow(40);
    expect(lines[0]).toBe("binding-name-here  a detail sentence");
  });

  it("never shrinks a wrapping column below a word", () => {
    const widths = narrow(20).map((line) => line.length);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(12);
  });

  it("overflows rather than shrink every column past its floor", () => {
    // Honest, and legible. The alternative is a grid whose every cell is one character wide.
    expect(narrow(6)[0]?.length).toBeGreaterThan(6);
  });

  it("leaves a column already narrower than its floor alone", () => {
    expect(
      renderGrid([{ a: "x", b: "a much longer value than the other one" }], {
        border: BORDERS.none,
        header: false,
        padding: 0,
        gap: 2,
        maxWidth: 24,
        columns: ["a", { key: "b", wrap: true }],
      })[0],
    ).toBe("x  a much longer value");
  });
});
