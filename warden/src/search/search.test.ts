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
  ["docs/NAMESPACES.md", { corpus: "local", weight: 1.2, body: "The comment budget is cited here." }],
  ["src/ui/README.md", { corpus: "local", weight: 0.9, body: "The comment budget is mentioned in passing." }],
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
    expect(search(db, "comment budget").map((hit) => hit.path)).toEqual(["CODE_RULES.md", "docs/NAMESPACES.md", "src/ui/README.md"]);
  });

  it("carries the heading trail and the gloss, so a hit can be read without a second call", () => {
    const [hit] = search(db, "comment budget");

    expect(hit?.headingPath).toBe("1. One");
    expect(hit?.gloss).toBe("One: what it decides");
    expect(hit?.id).toBe("canon/libs:CODE_RULES.md#1");
  });

  it("narrows by corpus, by tree and by path prefix", () => {
    expect(search(db, "comment budget", { corpus: "local" }).map((hit) => hit.corpus)).toEqual(["local", "local"]);
    expect(search(db, "numbered", { tree: "shared" }).map((hit) => hit.tree)).toEqual(["shared"]);
    expect(search(db, "comment budget", { path: "docs/" }).map((hit) => hit.path)).toEqual(["docs/NAMESPACES.md"]);
  });

  it("honours the limit", () => {
    expect(search(db, "comment budget", { limit: 1 })).toHaveLength(1);
  });

  it("is a pure function of the index — the same query twice returns the same order", () => {
    expect(search(db, "comment budget").map((hit) => hit.id)).toEqual(search(db, "comment budget").map((hit) => hit.id));
  });
});
