import { describe, expect, it } from "bun:test";

import { parseDiff } from "./git";

const diff = (...lines: string[]): string => lines.join("\n");

describe("parseDiff() — the hunk headers a --unified=0 diff writes", () => {
  it("reads one hunk as an inclusive range on the new side", () => {
    const text = diff("--- a/docs/TESTING.md", "+++ b/docs/TESTING.md", "@@ -10,3 +12,4 @@ ## 1. Runners", "+a line");

    expect(parseDiff(text)).toEqual([{ path: "docs/TESTING.md", ranges: [{ start: 12, end: 15 }] }]);
  });

  it("reads a hunk with no count as the single line it names", () => {
    const text = diff("+++ b/docs/TESTING.md", "@@ -10 +12 @@", "+a line");

    expect(parseDiff(text)).toEqual([{ path: "docs/TESTING.md", ranges: [{ start: 12, end: 12 }] }]);
  });

  it("keeps a zero-length hunk as one line, so a pure deletion is not reported as no change", () => {
    const text = diff("+++ b/docs/TESTING.md", "@@ -210,5 +209,0 @@", "-a deleted rule");

    expect(parseDiff(text)).toEqual([{ path: "docs/TESTING.md", ranges: [{ start: 209, end: 209 }] }]);
  });

  it("clamps a deletion at the top of a file to line 1, which is the lowest line there is", () => {
    const text = diff("+++ b/docs/TESTING.md", "@@ -1,4 +0,0 @@", "-gone");

    expect(parseDiff(text)).toEqual([{ path: "docs/TESTING.md", ranges: [{ start: 1, end: 1 }] }]);
  });

  it("collects every hunk of one file", () => {
    const text = diff("+++ b/docs/TESTING.md", "@@ -10,1 +10,1 @@", "+one", "@@ -40,0 +41,3 @@", "+two");

    expect(parseDiff(text)).toEqual([
      {
        path: "docs/TESTING.md",
        ranges: [
          { start: 10, end: 10 },
          { start: 41, end: 43 },
        ],
      },
    ]);
  });

  it("separates the hunks of two files by the `+++` header between them", () => {
    const text = diff("+++ b/a.md", "@@ -1,1 +1,1 @@", "+one", "+++ b/b.md", "@@ -5,1 +5,2 @@", "+two");

    expect(parseDiff(text)).toEqual([
      { path: "a.md", ranges: [{ start: 1, end: 1 }] },
      { path: "b.md", ranges: [{ start: 5, end: 6 }] },
    ]);
  });

  it("skips a deleted file, whose new side is /dev/null and resolves against no indexed document", () => {
    const text = diff("+++ /dev/null", "@@ -1,20 +0,0 @@", "-everything", "+++ b/kept.md", "@@ -1,1 +1,1 @@", "+one");

    expect(parseDiff(text)).toEqual([{ path: "kept.md", ranges: [{ start: 1, end: 1 }] }]);
  });

  it("takes the new path of a rename, which is where the lines now live", () => {
    const text = diff("--- a/old.md", "+++ b/new.md", "@@ -3,1 +3,1 @@", "+one");

    expect(parseDiff(text)).toEqual([{ path: "new.md", ranges: [{ start: 3, end: 3 }] }]);
  });

  it("returns a file with no hunks when the diff records only a rename", () => {
    expect(parseDiff(diff("--- a/old.md", "+++ b/new.md"))).toEqual([{ path: "new.md", ranges: [] }]);
  });

  it("returns nothing for an empty diff", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("ignores a hunk header before any `+++` line, which names no file to attribute it to", () => {
    expect(parseDiff(diff("@@ -1,1 +1,1 @@", "+orphan"))).toEqual([]);
  });
});
