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
].join("\n");

const root = mkdtempSync(join(tmpdir(), "warden-read-"));
const file = join(root, "RULES.md");
writeFileSync(file, SOURCE, "utf-8");
const doc: SourceDoc = { corpus: "local", path: "docs/RULES.md", file, weight: 1.2 };

const db = openDatabase(":memory:");
build(db, [doc], "1.0.0");

describe("readSection()", () => {
  it("returns one section whole", () => {
    const [section] = readSection(db, "local:docs/RULES.md#1a");

    expect(section?.id).toBe("local:docs/RULES.md#1a");
    expect(section?.section).toBe("1a");
    expect(section?.title).toBe("Sub");
    expect(section?.body).toBe("Refined body.");
    expect(section?.gloss).toBe("Sub: the refinement");
  });

  it("returns the sections either side when asked — the rule above usually scopes the one below", () => {
    expect(readSection(db, "local:docs/RULES.md#1a", 1).map((section) => section.section)).toEqual(["1", "1a", "2"]);
  });

  it("returns nothing for an id no chunk carries", () => {
    expect(readSection(db, "local:docs/RULES.md#9")).toEqual([]);
  });
});

describe("outline()", () => {
  it("lists every section with its gloss, indenting a refinement under its parent", () => {
    expect(outline(db, "docs/RULES.md")).toEqual([
      { id: "local:docs/RULES.md#1", section: "1", title: "One", gloss: "One: the first", level: 1 },
      { id: "local:docs/RULES.md#1a", section: "1a", title: "Sub", gloss: "Sub: the refinement", level: 2 },
      { id: "local:docs/RULES.md#2", section: "2", title: "Two", gloss: "Two: the second", level: 1 },
    ]);
  });

  it("returns nothing for a path no document carries, so a caller can say so", () => {
    expect(outline(db, "docs/ABSENT.md")).toEqual([]);
  });
});

describe("readDocument()", () => {
  it("returns every section in document order", () => {
    expect(readDocument(db, "docs/RULES.md").map((section) => section.body)).toEqual(["First body.", "Refined body.", "Second body."]);
  });
});
