import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build } from "../index/build";
import { openDatabase } from "../index/db";
import type { SourceDoc } from "../types";
import { impact } from "./impact";

const PKG = { name: "@y-core/forge", exports: { "./http": { import: "./src/http/mod.ts" }, "./router": "./src/router/mod.ts" } };

/** A repository holding the given documents, with its index already built. */
function fixture(files: Record<string, string>): { root: string; db: ReturnType<typeof openDatabase>; sources: SourceDoc[] } {
  const root = mkdtempSync(join(tmpdir(), "warden-impact-"));
  writeFileSync(join(root, "package.json"), JSON.stringify(PKG), "utf-8");

  const sources = Object.entries(files).map(([path, source]) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
    return { corpus: "project" as const, path, file: full, weight: 1.2 };
  });

  const db = openDatabase(join(root, "index.sqlite"));
  build(db, sources, "test", PKG.name);
  return { root, db, sources };
}

const OWNER = [
  "---",
  "title: Owner",
  'description: "One sentence."',
  "---",
  "",
  "## 0. Quick Reference",
  "",
  "- §1 One: the http rule",
  "- §2 Two: the router rule",
  "",
  "## 1. One",
  "",
  "Every HTTP output concern goes to `@y-core/forge/http`.",
  "",
  "## 2. Two",
  "",
  "Routing lives in `@y-core/forge/router`.",
  "",
].join("\n");

const READER = [
  "---",
  "title: Reader",
  'description: "One sentence."',
  "---",
  "",
  "## 0. Quick Reference",
  "",
  "- §1 One: what it defers",
  "",
  "## 1. One",
  "",
  "See `OWNER.md` §1 for the output rule.",
  "",
].join("\n");

describe("impact()", () => {
  const files = { "docs/OWNER.md": OWNER, "docs/READER.md": READER };

  it("names the section a changed line falls inside, and nothing else", () => {
    const { root, db, sources } = fixture(files);
    const report = impact(db, root, sources, "HEAD", [{ path: "docs/OWNER.md", ranges: [{ start: 13, end: 13 }] }]);

    expect(report.touched.map((section) => section.id)).toEqual(["project:docs/OWNER.md#1"]);
    db.close();
  });

  it("clamps the reported lines to the section, so a range spanning two reports each one's own", () => {
    const { root, db, sources } = fixture(files);
    const report = impact(db, root, sources, "HEAD", [{ path: "docs/OWNER.md", ranges: [{ start: 11, end: 18 }] }]);

    expect(report.touched.map((section) => `${section.id} ${section.lines.map((line) => `${line.start}-${line.end}`).join(",")}`)).toEqual([
      "project:docs/OWNER.md#1 11-14",
      "project:docs/OWNER.md#2 15-18",
    ]);
    db.close();
  });

  it("names what cites the changed section — the question a reviewer asks before editing a rule", () => {
    const { root, db, sources } = fixture(files);
    const report = impact(db, root, sources, "HEAD", [{ path: "docs/OWNER.md", ranges: [{ start: 13, end: 13 }] }]);

    expect(report.touched[0]?.dependents).toEqual(["project:docs/READER.md#1"]);
    db.close();
  });

  it("resolves each governed subpath to the barrel its exports entry names, in either entry shape", () => {
    const { root, db, sources } = fixture(files);
    const report = impact(db, root, sources, "HEAD", [{ path: "docs/OWNER.md", ranges: [{ start: 11, end: 18 }] }]);

    expect(report.touched.map((section) => section.governs)).toEqual([
      [{ subpath: "./http", target: "./src/http/mod.ts" }],
      [{ subpath: "./router", target: "./src/router/mod.ts" }],
    ]);
    db.close();
  });

  it("names a subpath with no exports entry rather than dropping it", () => {
    const { root, db, sources } = fixture({
      "docs/OWNER.md": OWNER.replace("`@y-core/forge/http`", "`@y-core/forge/retired`"),
      "docs/READER.md": READER,
    });
    const report = impact(db, root, sources, "HEAD", [{ path: "docs/OWNER.md", ranges: [{ start: 13, end: 13 }] }]);

    expect(report.touched[0]?.governs).toEqual([{ subpath: "./retired" }]);
    db.close();
  });

  it("reports a changed file the index does not hold, so a silent miss is not one", () => {
    const { root, db, sources } = fixture(files);
    const report = impact(db, root, sources, "HEAD", [{ path: "notes/scratch.md", ranges: [{ start: 1, end: 2 }] }]);

    expect(report).toMatchObject({ touched: [], unindexed: ["notes/scratch.md"] });
    db.close();
  });

  it("finds no section when the changed lines fall outside every one — a frontmatter edit", () => {
    const { root, db, sources } = fixture(files);
    const report = impact(db, root, sources, "HEAD", [{ path: "docs/OWNER.md", ranges: [{ start: 2, end: 2 }] }]);

    expect(report.touched).toEqual([]);
    db.close();
  });
});
