import { describe, expect, it } from "bun:test";

import type { SourceDoc } from "../types";
import { chunkDocument, frontmatter, glossary, proseOf, ruleClauses } from "./chunk";

const DOC: SourceDoc = { corpus: "canon", tree: "libs", path: "CODE_RULES.md", file: "/nowhere/CODE_RULES.md", weight: 1.3 };

const SOURCE = [
  "---",
  "title: Code Rules",
  'description: "Six rules every source file obeys."',
  "---",
  "",
  "# Code Rules",
  "",
  "## 0. Quick Reference",
  "",
  "- §1 Zero Global State: why an isolate makes it unsafe",
  "- §1a No Module-Level Mutable Variables: the rule itself",
  "- §2 Explicit Errors: return failures",
  "",
  "## 1. Zero Global State",
  "",
  "The lead paragraph, which the parent keeps.",
  "",
  "### 1a. No Module-Level Mutable Variables",
  "",
  "**A module-level `let` outlives the request.** See [`BOUNDARIES.md`](./BOUNDARIES.md) §1.",
  "",
  "```ts",
  "let counter = 0;",
  "```",
  "",
  "## 2. Explicit Errors",
  "",
  "**Return failures, never throw them.**",
  "",
].join("\n");

describe("frontmatter()", () => {
  it("reads the two fields, quotes stripped", () => {
    expect(frontmatter(SOURCE)).toEqual({ title: "Code Rules", description: "Six rules every source file obeys." });
  });

  it("returns empties for a document carrying none", () => {
    expect(frontmatter("# Title\n")).toEqual({ title: "", description: "" });
  });
});

describe("glossary()", () => {
  it("keys each Quick Reference line by the section it names", () => {
    expect(glossary(SOURCE.split("\n"))).toEqual(
      new Map([
        ["1", "Zero Global State: why an isolate makes it unsafe"],
        ["1a", "No Module-Level Mutable Variables: the rule itself"],
        ["2", "Explicit Errors: return failures"],
      ]),
    );
  });

  it("returns nothing for a document with no Quick Reference", () => {
    expect(glossary(["## 1. One", "Body."])).toEqual(new Map());
  });
});

describe("ruleClauses()", () => {
  it("collects the bolded clauses, and drops the sentence punctuation the tokenizer would keep", () => {
    expect(ruleClauses(["**One rule.** Prose.", "And **another**."])).toBe("One rule another");
  });
});

describe("proseOf()", () => {
  it("flattens a link to its text, so a URL never outranks a sentence", () => {
    expect(proseOf(["See [`BOUNDARIES.md`](./BOUNDARIES.md) §1."])).toBe("See `BOUNDARIES.md` §1");
  });

  it("strips a sentence-final period and keeps one inside an identifier", () => {
    expect(proseOf(["The budget. Declared in `assets.config.ts` and read by `mod.ts`."])).toBe(
      "The budget Declared in `assets.config.ts` and read by `mod.ts`",
    );
  });
});

describe("chunkDocument()", () => {
  const chunks = chunkDocument(DOC, SOURCE);

  it("never emits the Quick Reference as a chunk — it would match every query", () => {
    expect(chunks.map((chunk) => chunk.section)).toEqual(["1", "1a", "2"]);
  });

  it("gives every chunk the id a citation already spells", () => {
    expect(chunks.map((chunk) => chunk.id)).toEqual(["canon:CODE_RULES.md#1", "canon:CODE_RULES.md#1a", "canon:CODE_RULES.md#2"]);
  });

  it("chunks at the leaf: a parent keeps its lead paragraph and nothing of its children", () => {
    expect(chunks[0]?.body).toBe("The lead paragraph, which the parent keeps.");
    expect(chunks[0]?.body).not.toContain("module-level");
  });

  it("redistributes the Quick Reference line into the section it names", () => {
    expect(chunks[1]?.gloss).toBe("No Module-Level Mutable Variables: the rule itself");
  });

  it("carries the heading trail, so a `Na` hit says which `N` it refines", () => {
    expect(chunks[1]?.headingPath).toBe("1. Zero Global State › 1a. No Module-Level Mutable Variables");
  });

  it("keeps the fence in `body` and strips it from what is searched", () => {
    expect(chunks[1]?.body).toContain("let counter = 0;");
    expect(chunks[1]?.searchBody).not.toContain("let counter = 0;");
  });

  it("lifts the bolded clause into its own column", () => {
    expect(chunks[1]?.rules).toBe("A module-level `let` outlives the request");
  });
});

describe("chunkDocument() — a document numbering two sections the same", () => {
  const source = ["## 1. One", "", "First.", "", "## 1. One Again", "", "Second.", ""].join("\n");

  it("suffixes the second rather than colliding, so a build reports it instead of throwing", () => {
    expect(chunkDocument(DOC, source).map((chunk) => chunk.section)).toEqual(["1", "1-2"]);
  });
});

describe("chunkDocument() — a fence-only section that carries a gloss", () => {
  const source = ["## 0. Quick Reference", "", "- §1 Usage: how to call it", "", "## 1. Usage", "", "```ts", "run();", "```", ""].join("\n");

  it("is searchable on the columns that outrank the body, not discarded with the bodyless", () => {
    const [chunk] = chunkDocument(DOC, source);

    expect(chunk?.searchBody).toBe("");
    expect(chunk?.gloss).toBe("Usage: how to call it");
    expect(chunk?.searchable).toBe(true);
  });
});

describe("chunkDocument() — a heading quoted inside a fence", () => {
  const readme: SourceDoc = { corpus: "project", path: "src/ui/README.md", file: "/nowhere/README.md", weight: 0.9 };
  const source = ["# UI", "", "## One", "", "Before.", "", "```md", "## Fake Heading", "```", "", "After.", ""].join("\n");

  it("is a line of an example, not a boundary — the section stays whole", () => {
    const chunks = chunkDocument(readme, source);

    expect(chunks.map((chunk) => chunk.section)).toEqual(["~one"]);
    expect(chunks[0]?.body).toContain("Before.");
    expect(chunks[0]?.body).toContain("After.");
  });
});

describe("chunkDocument() — a document with no section numbers", () => {
  const readme: SourceDoc = { corpus: "project", path: "src/ui/README.md", file: "/nowhere/README.md", weight: 0.9 };
  const source = ["# UI", "", "## Sub-path A", "", "### Exports", "", "One.", "", "## Sub-path B", "", "### Exports", "", "Two.", ""].join("\n");

  it("qualifies a repeated slug by its parent", () => {
    expect(chunkDocument(readme, source).map((chunk) => chunk.section)).toEqual([
      "~sub-path-a",
      "~sub-path-a~exports",
      "~sub-path-b",
      "~sub-path-b~exports",
    ]);
  });

  it("keeps a parent whose children carry everything, but out of the search index", () => {
    const byName = new Map(chunkDocument(readme, source).map((chunk) => [chunk.section, chunk]));

    expect(byName.get("~sub-path-a")?.searchable).toBe(false);
    expect(byName.get("~sub-path-a")?.body).toBe("");
    expect(byName.get("~sub-path-a~exports")?.searchable).toBe(true);
  });

  it("keeps a fence-only section readable but out of the search index", () => {
    const fenced = ["# UI", "", "## Usage", "", "```ts", "run();", "```", ""].join("\n");
    const [chunk] = chunkDocument(readme, fenced);

    expect(chunk?.searchable).toBe(false);
    expect(chunk?.body).toContain("run();");
  });

  it("keeps every id unique, which is what makes one an address", () => {
    const ids = chunkDocument(readme, source).map((chunk) => chunk.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("chunkDocument() — the line span each section carries", () => {
  const readme: SourceDoc = { corpus: "project", path: "src/ui/README.md", file: "/nowhere/README.md", weight: 0.9 };

  it("records the 1-indexed heading line and the last line of the block", () => {
    // 1: # UI  2: (blank)  3: ## One  4: (blank)  5: First.  6: (blank)  7: ## Two  8: (blank)  9: Second.
    const source = ["# UI", "", "## One", "", "First.", "", "## Two", "", "Second."].join("\n");

    expect(chunkDocument(readme, source).map((chunk) => `${chunk.section} ${chunk.line}-${chunk.endLine}`)).toEqual(["~one 3-6", "~two 7-9"]);
  });

  it("counts a heading quoted inside a fence as a line of the block, not a boundary", () => {
    const source = ["# UI", "", "## One", "", "```md", "## Fake Heading", "```", "", "After."].join("\n");
    const [chunk] = chunkDocument(readme, source);

    expect([chunk?.line, chunk?.endLine]).toEqual([3, 9]);
  });

  it("skips the Quick Reference, so the first span belongs to §1 and not to §0", () => {
    const source = [
      "---",
      "title: A",
      'description: "One."',
      "---",
      "",
      "## 0. Quick Reference",
      "",
      "- §1 One: it",
      "",
      "## 1. One",
      "",
      "Body.",
    ].join("\n");
    const doc: SourceDoc = { corpus: "project", path: "docs/A.md", file: "/nowhere/A.md", weight: 1.2 };

    expect(chunkDocument(doc, source).map((chunk) => `${chunk.section} ${chunk.line}-${chunk.endLine}`)).toEqual(["1 10-12"]);
  });
});
