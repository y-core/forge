import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { SourceDoc } from "../types";
import { build, load } from "./build";
import { openDatabase } from "./db";

function doc(title: string, body: string): string {
  return `---\ntitle: ${title}\ndescription: "One sentence."\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\n${body}\n`;
}

function fixture(files: Record<string, string>, prefix: string): SourceDoc[] {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return Object.entries(files).map(([path, source]) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
    return { corpus: "local" as const, path, file: full, weight: 1.2 };
  });
}

describe("load()", () => {
  it("reads the frontmatter, the chunks and the size and hash a freshness check compares", () => {
    const [entry] = load(fixture({ "docs/A.md": doc("A", "Body.") }, "warden-load-"));

    expect(entry?.title).toBe("A");
    expect(entry?.description).toBe("One sentence.");
    expect(entry?.chunks).toHaveLength(1);
    expect(entry?.size).toBeGreaterThan(0);
    expect(entry?.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("falls back to the path when a document carries no title", () => {
    expect(load(fixture({ "docs/A.md": "## 1. One\n\nBody.\n" }, "warden-untitled-"))[0]?.title).toBe("docs/A.md");
  });
});

describe("build()", () => {
  it("reports what it wrote", () => {
    const db = openDatabase(":memory:");
    const sources = fixture({ "docs/A.md": doc("A", "See `B.md` §1."), "docs/B.md": doc("B", "Body.") }, "warden-build-");

    const report = build(db, sources, "1.0.0");

    expect(report).toEqual({ documents: 2, chunks: 2, relations: 1, unresolved: 0 });
    db.close();
  });

  it("fills the FTS table from the chunks, so a search has something to match", () => {
    const db = openDatabase(":memory:");
    build(db, fixture({ "docs/A.md": doc("A", "The comment budget.") }, "warden-fts-"), "1.0.0");

    expect(db.query<{ c: number }>("SELECT count(*) AS c FROM chunk_fts WHERE chunk_fts MATCH ?").get('"budget"')?.c).toBe(1);
    db.close();
  });

  it("replaces the previous index rather than appending to it", () => {
    const db = openDatabase(":memory:");
    build(db, fixture({ "docs/A.md": doc("A", "Body."), "docs/B.md": doc("B", "Body.") }, "warden-replace-a-"), "1.0.0");
    build(db, fixture({ "docs/A.md": doc("A", "Body.") }, "warden-replace-b-"), "1.0.0");

    expect(db.query<{ c: number }>("SELECT count(*) AS c FROM source").get()?.c).toBe(1);
    expect(db.query<{ c: number }>("SELECT count(*) AS c FROM chunk").get()?.c).toBe(1);
    db.close();
  });

  it("counts a citation that resolves to nothing as unresolved rather than dropping it", () => {
    const db = openDatabase(":memory:");

    expect(build(db, fixture({ "docs/A.md": doc("A", "See `ABSENT.md` §1.") }, "warden-unresolved-"), "1.0.0").unresolved).toBe(1);
    db.close();
  });

  it("stamps the versions a stale index is recognised by", () => {
    const db = openDatabase(":memory:");
    build(db, fixture({ "docs/A.md": doc("A", "Body.") }, "warden-stamp-"), "9.9.9");

    expect(db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'canon_version'").get()?.value).toBe("9.9.9");
    db.close();
  });
});
