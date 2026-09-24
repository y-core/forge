import { describe, expect, it } from "bun:test";

import { renderImpact } from "./render";

describe("renderImpact()", () => {
  it("renders a section, its dependents and the code it governs as the three labelled blocks", () => {
    const rendered = renderImpact({
      ref: "HEAD~1",
      unindexed: [],
      touched: [
        {
          id: "project:docs/OWNER.md#1",
          headingPath: "docs/OWNER.md § 1. One",
          lines: [{ start: 13, end: 14 }],
          dependents: ["project:docs/READER.md#1"],
          governs: [{ subpath: "./http", target: "./src/http/mod.ts" }],
        },
      ],
    });

    expect(rendered).toBe(
      [
        "changed  project:docs/OWNER.md#1 (lines 13-14)",
        "         docs/OWNER.md § 1. One",
        "  depends on it  project:docs/READER.md#1",
        "  governs        ./http → ./src/http/mod.ts",
        "",
      ].join("\n"),
    );
  });

  it("writes a single changed line as one number rather than a degenerate range", () => {
    const rendered = renderImpact({
      ref: "HEAD",
      unindexed: [],
      touched: [{ id: "project:docs/A.md#1", headingPath: "docs/A.md § 1. One", lines: [{ start: 9, end: 9 }], dependents: [], governs: [] }],
    });

    expect(rendered).toBe(["changed  project:docs/A.md#1 (lines 9)", "         docs/A.md § 1. One", ""].join("\n"));
  });

  it("says so when a ref changed no governing section, rather than printing nothing at all", () => {
    expect(renderImpact({ ref: "HEAD~1", unindexed: [], touched: [] })).toBe("no governing section changed in HEAD~1\n");
  });

  it("lists the files the index does not hold under the sections it does", () => {
    expect(renderImpact({ ref: "HEAD", unindexed: ["notes/scratch.md"], touched: [] })).toContain("not indexed: notes/scratch.md");
  });
});
