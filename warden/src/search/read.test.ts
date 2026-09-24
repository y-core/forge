import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "../index/build";
import { openDatabase } from "../index/db";
import type { SourceDoc } from "../types";
import { outline, readDocument, readSection } from "./read";

const SOURCE = [
  "---",
  "title: Rules",
  'description: "One."',
  "---",
  "",
  "## 0. Quick Reference",
  "",
  "- §1 One: the first",
  "- §1a Sub: the refinement",
  "- §2 Two: the second",
  "- §3 Three: the heading with no body of its own",
  "- §3a First: the first child",
  "- §3b Second: the second child",
  "- §4 Four: the fourth",
  "",
  "## 1. One",
  "",
  "First body.",
  "",
  "### 1a. Sub",
  "",
  "Refined body.",
  "",
  "## 2. Two",
  "",
  "Second body.",
  "",
  "## 3. Three",
  "",
  "### 3a. First",
  "",
  "First child body.",
  "",
  "### 3b. Second",
  "",
  "Second child body.",
  "",
  "## 4. Four",
  "",
  "Fourth body.",
  "",
].join("\n");

const root = mkdtempSync(join(tmpdir(), "warden-read-"));
const file = join(root, "RULES.md");
writeFileSync(file, SOURCE, "utf-8");
const doc: SourceDoc = { corpus: "project", path: "docs/RULES.md", file, weight: 1.2 };

const db = openDatabase(":memory:");
build(db, [doc], "1.0.0");

describe("readSection()", () => {
  it("returns one section whole", () => {
    const [section] = readSection(db, "project:docs/RULES.md#1a");

    expect(section?.id).toBe("project:docs/RULES.md#1a");
    expect(section?.section).toBe("1a");
    expect(section?.title).toBe("Sub");
    expect(section?.body).toBe("Refined body.");
    expect(section?.gloss).toBe("Sub: the refinement");
  });

  it("returns the sections either side when asked — the rule above usually scopes the one below", () => {
    expect(readSection(db, "project:docs/RULES.md#1a", 1).map((section) => section.section)).toEqual(["1", "1a", "2"]);
  });

  it("answers a section that only heads its subsections with those subsections", () => {
    const sections = readSection(db, "project:docs/RULES.md#3");

    expect(sections.map((section) => section.section)).toEqual(["3", "3a", "3b"]);
    expect(sections.map((section) => section.body)).toEqual(["", "First child body.", "Second child body."]);
  });

  it("stops the children at the next section of the parent's own level", () => {
    expect(readSection(db, "project:docs/RULES.md#3", 1).map((section) => section.section)).toEqual(["3", "3a", "3b"]);
  });

  it("returns nothing for an id no chunk carries", () => {
    expect(readSection(db, "project:docs/RULES.md#9")).toEqual([]);
  });
});

describe("outline()", () => {
  it("lists every section with its gloss, indenting a refinement under its parent", () => {
    expect(outline(db, "docs/RULES.md")).toEqual([
      { id: "project:docs/RULES.md#1", section: "1", title: "One", gloss: "One: the first", level: 1 },
      { id: "project:docs/RULES.md#1a", section: "1a", title: "Sub", gloss: "Sub: the refinement", level: 2 },
      { id: "project:docs/RULES.md#2", section: "2", title: "Two", gloss: "Two: the second", level: 1 },
      { id: "project:docs/RULES.md#3", section: "3", title: "Three", gloss: "Three: the heading with no body of its own", level: 1 },
      { id: "project:docs/RULES.md#3a", section: "3a", title: "First", gloss: "First: the first child", level: 2 },
      { id: "project:docs/RULES.md#3b", section: "3b", title: "Second", gloss: "Second: the second child", level: 2 },
      { id: "project:docs/RULES.md#4", section: "4", title: "Four", gloss: "Four: the fourth", level: 1 },
    ]);
  });

  it("returns nothing for a path no document carries, so a caller can say so", () => {
    expect(outline(db, "docs/ABSENT.md")).toEqual([]);
  });

  it("keeps two documents sharing a path whole rather than interleaving them by ordinal", () => {
    const shared = openDatabase(":memory:");
    build(
      shared,
      [
        { corpus: "canon", tree: "shared", path: "X.md", file, weight: 1 },
        { corpus: "project", path: "X.md", file, weight: 1 },
      ],
      "1.0.0",
    );

    const documents = outline(shared, "X.md").map((entry) => entry.id.slice(0, entry.id.indexOf("#")));

    // Two documents, and exactly two runs of them: one more would mean the two were interleaved.
    const runs = documents.filter((id, index) => id !== documents[index - 1]);

    expect(new Set(documents).size).toBe(2);
    expect(runs).toEqual(["canon:X.md", "project:X.md"]);
    shared.close();
  });
});

describe("readDocument()", () => {
  it("returns every section in document order", () => {
    expect(readDocument(db, "docs/RULES.md").map((section) => section.body)).toEqual([
      "First body.",
      "Refined body.",
      "Second body.",
      "",
      "First child body.",
      "Second child body.",
      "Fourth body.",
    ]);
  });
});
