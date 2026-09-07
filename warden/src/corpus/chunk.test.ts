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
    expect(chunks.map((chunk) => chunk.id)).toEqual(["canon/libs:CODE_RULES.md#1", "canon/libs:CODE_RULES.md#1a", "canon/libs:CODE_RULES.md#2"]);
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

describe("chunkDocument() — a document with no section numbers", () => {
  const readme: SourceDoc = { corpus: "local", path: "src/ui/README.md", file: "/nowhere/README.md", weight: 0.9 };
  const source = ["# UI", "", "## Sub-path A", "", "### Exports", "", "One.", "", "## Sub-path B", "", "### Exports", "", "Two.", ""].join("\n");

  it("qualifies a repeated slug by its parent, and drops a parent whose children carry everything", () => {
    expect(chunkDocument(readme, source).map((chunk) => chunk.section)).toEqual(["~sub-path-a~exports", "~sub-path-b~exports"]);
  });

  it("keeps every id unique, which is what makes one an address", () => {
    const ids = chunkDocument(readme, source).map((chunk) => chunk.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
