import { describe, expect, it } from "bun:test";

import type { Chunk, SourceDoc } from "../types";
import { citationTarget, headerOf, relationsOf, resolveDoc } from "./relate";

const SOURCES: SourceDoc[] = [
  { corpus: "canon", tree: "libs", path: "CODE_RULES.md", file: "/c/CODE_RULES.md", weight: 1.3 },
  { corpus: "canon", tree: "libs", path: "TESTING.md", file: "/c/TESTING.md", weight: 1.3 },
  { corpus: "local", path: "docs/TESTING.md", file: "/r/docs/TESTING.md", weight: 1.2 },
];

const DOC = SOURCES[2] as SourceDoc;

const chunk = (id: string, body: string): Chunk => ({
  id,
  section: "1",
  title: "One",
  headingPath: "1. One",
  gloss: "",
  rules: "",
  searchBody: body,
  body,
  ordinal: 0,
});

describe("resolveDoc()", () => {
  it("resolves a spelling that names exactly one document", () => {
    expect(resolveDoc("CODE_RULES.md", SOURCES)).toBe("canon/libs:CODE_RULES.md");
  });

  it("leaves an ambiguous basename unresolved rather than guessing", () => {
    expect(resolveDoc("TESTING.md", SOURCES)).toBeUndefined();
  });

  it("disambiguates by the tree prefix a chunk id already uses", () => {
    expect(resolveDoc("libs/TESTING.md", SOURCES)).toBe("canon/libs:TESTING.md");
  });

  it("resolves a document nobody names to nothing", () => {
    expect(resolveDoc("ABSENT.md", SOURCES)).toBeUndefined();
  });
});

describe("headerOf()", () => {
  it("takes everything before the first level-2 heading", () => {
    expect(headerOf("---\ntitle: X\n---\n\n> Defers to: A.md\n\n## 1. One\n\nBody.")).toContain("Defers to");
    expect(headerOf("---\ntitle: X\n---\n\n## 1. One\n\nBody.")).not.toContain("Body.");
  });
});

describe("relationsOf()", () => {
  it("reads a `> Defers to:` header into one edge per document it names", () => {
    const header = "> Defers to: [`CODE_RULES.md`](./CODE_RULES.md) §5c for the budget.";

    expect(relationsOf(DOC, [], header, SOURCES)).toEqual([
      { from: "local:docs/TESTING.md", kind: "defers", raw: "CODE_RULES.md", to: "canon/libs:CODE_RULES.md" },
    ]);
  });

  it("reads a §N citation in a chunk into an edge on that section", () => {
    const chunks = [chunk("local:docs/TESTING.md#1", "See `CODE_RULES.md` §5c for the rule.")];

    expect(relationsOf(DOC, chunks, "", SOURCES)).toEqual([
      { from: "local:docs/TESTING.md#1", kind: "cites", raw: "CODE_RULES.md §5c", to: "canon/libs:CODE_RULES.md#5c" },
    ]);
  });

  it("keeps an unresolvable citation with its raw spelling rather than dropping it", () => {
    const chunks = [chunk("local:docs/TESTING.md#1", "See `ABSENT.md` §1.")];

    expect(relationsOf(DOC, chunks, "", SOURCES)).toEqual([{ from: "local:docs/TESTING.md#1", kind: "cites", raw: "ABSENT.md §1" }]);
  });

  it("emits one edge for a citation a section repeats", () => {
    const chunks = [chunk("local:docs/TESTING.md#1", "`CODE_RULES.md` §5c, and again `CODE_RULES.md` §5c.")];

    expect(relationsOf(DOC, chunks, "", SOURCES)).toHaveLength(1);
  });
});

describe("citationTarget()", () => {
  it("builds the chunk id a `DOC.md §N` citation names", () => {
    expect(citationTarget("CODE_RULES.md", "5c", SOURCES)).toBe("canon/libs:CODE_RULES.md#5c");
  });
});
