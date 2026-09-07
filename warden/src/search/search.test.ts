import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build } from "../index/build";
import { openDatabase } from "../index/db";
import type { SourceDoc } from "../types";
import { search } from "./search";

function doc(title: string, body: string): string {
  return `---\ntitle: ${title}\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\n${body}\n`;
}

const CORPUS: Array<[SourceDoc, string]> = [];
const root = mkdtempSync(join(tmpdir(), "warden-search-"));
for (const [path, entry] of [
  ["CODE_RULES.md", { corpus: "canon", tree: "libs", weight: 1.3, body: "The comment budget is a ceiling." }],
  ["AGENT_GUIDE.md", { corpus: "canon", tree: "shared", weight: 1.3, body: "A document is numbered." }],
  ["docs/NAMESPACES.md", { corpus: "project", weight: 1.2, body: "The comment budget is cited here." }],
  ["docs/NAMESPACES_OLD.md", { corpus: "project", weight: 1.2, body: "The comment budget is cited here too." }],
  ["src/ui/README.md", { corpus: "project", weight: 0.9, body: "The comment budget is mentioned in passing." }],
] as const) {
  const file = join(root, path.replace("/", "-"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, doc("Doc", entry.body), "utf-8");
  CORPUS.push([{ corpus: entry.corpus, ...("tree" in entry ? { tree: entry.tree } : {}), path, file, weight: entry.weight }, entry.body]);
}

const db = openDatabase(":memory:");
build(
  db,
  CORPUS.map(([source]) => source),
  "1.0.0",
);

describe("search()", () => {
  it("returns nothing for a query with no term rather than everything", () => {
    expect(search(db, "!!!")).toEqual([]);
  });

  it("ranks the canon above this repository's docs, and both above a README", () => {
    expect(search(db, "comment budget").map((hit) => hit.path)).toEqual([
      "CODE_RULES.md",
      "docs/NAMESPACES.md",
      "docs/NAMESPACES_OLD.md",
      "src/ui/README.md",
    ]);
  });

  it("carries the heading trail and the gloss, so a hit can be read without a second call", () => {
    const [hit] = search(db, "comment budget");

    expect(hit?.headingPath).toBe("1. One");
    expect(hit?.gloss).toBe("One: what it decides");
    expect(hit?.id).toBe("canon:CODE_RULES.md#1");
  });

  it("narrows by corpus and by path", () => {
    expect(search(db, "comment budget", { corpus: "project" }).map((hit) => hit.corpus)).toEqual(["project", "project", "project"]);
    expect(search(db, "comment budget", { path: "docs/" }).map((hit) => hit.path)).toEqual(["docs/NAMESPACES.md", "docs/NAMESPACES_OLD.md"]);
    expect(search(db, "comment budget", { path: "docs/NAMESPACES.md" }).map((hit) => hit.path)).toEqual(["docs/NAMESPACES.md"]);
  });

  it("matches a path on the segment boundary, so a prefix of a filename is not a prefix of a path", () => {
    expect(search(db, "comment budget", { path: "docs/NAMESPACES" })).toEqual([]);
  });

  it("treats a path's `%` and `_` as characters rather than as wildcards", () => {
    expect(search(db, "comment budget", { path: "docs/%" })).toEqual([]);
    expect(search(db, "comment budget", { path: "docs/NAMESPACES_OLD.md" }).map((hit) => hit.path)).toEqual(["docs/NAMESPACES_OLD.md"]);
  });

  it("honours the limit", () => {
    expect(search(db, "comment budget", { limit: 1 })).toHaveLength(1);
  });

  it("is a pure function of the index — the same query twice returns the same order", () => {
    expect(search(db, "comment budget").map((hit) => hit.id)).toEqual(search(db, "comment budget").map((hit) => hit.id));
  });

  it("refuses a question the corpus has no vocabulary for, rather than offering its best near miss", () => {
    // Every hit this returns without the floor is matched on `budget` alone.
    expect(search(db, "zarquon quota budget", { floor: 0 }).length).toBeGreaterThan(0);
    expect(search(db, "zarquon quota budget")).toEqual([]);
  });

  it("carries the coverage that decided it, so a caller can see how much of its question was met", () => {
    const [hit] = search(db, "comment budget");

    expect(hit?.coverage).toBe(1);
  });

  it("keeps a hit that covers the whole query even when the query is one term", () => {
    expect(search(db, "budget").map((hit) => hit.path)).toContain("CODE_RULES.md");
  });
});

describe("search() — coverage in the ranking", () => {
  it("ranks a chunk covering the whole query above one BM25 alone would lead with", () => {
    // Both carry `budget`; only the canon chunk carries `ceiling` too.
    const ids = search(db, "comment budget ceiling", { floor: 0 }).map((hit) => hit.id);

    expect(ids[0]).toBe("canon:CODE_RULES.md#1");
  });

  it("stays a pure function of the index — the blend does not make the order depend on insertion", () => {
    expect(search(db, "comment budget").map((hit) => hit.id)).toEqual(search(db, "comment budget").map((hit) => hit.id));
  });
});
