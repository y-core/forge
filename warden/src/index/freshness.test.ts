import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { SourceDoc } from "../types";
import { build } from "./build";
import { openDatabase } from "./db";
import { advisory, freshness } from "./freshness";

function fixture(files: Record<string, string>, prefix: string): { root: string; sources: SourceDoc[] } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const sources = Object.entries(files).map(([path, source]) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
    return { corpus: "project" as const, path, file: full, weight: 1.2 };
  });
  return { root, sources };
}

const DOC = '---\ntitle: A\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\nBody.\n';

describe("freshness()", () => {
  it("is fresh straight after a build", () => {
    const db = openDatabase(":memory:");
    const { sources } = fixture({ "docs/A.md": DOC }, "warden-fresh-");
    build(db, sources, "1.0.0");

    expect(freshness(db, sources, "1.0.0")).toEqual({ fresh: true, rebuild: false, stale: [], reason: "" });
    db.close();
  });

  it("demands a whole rebuild when the canon version moved", () => {
    const db = openDatabase(":memory:");
    const { sources } = fixture({ "docs/A.md": DOC }, "warden-version-");
    build(db, sources, "1.0.0");

    const state = freshness(db, sources, "1.0.1");

    expect(state.rebuild).toBe(true);
    expect(state.reason).toContain("canon version");
    db.close();
  });

  it("demands a whole rebuild when the document set changed", () => {
    const db = openDatabase(":memory:");
    const { sources } = fixture({ "docs/A.md": DOC, "docs/B.md": DOC }, "warden-set-");
    build(db, sources, "1.0.0");

    expect(freshness(db, sources.slice(0, 1), "1.0.0").rebuild).toBe(true);
    db.close();
  });

  it("names the one document whose bytes changed", () => {
    const db = openDatabase(":memory:");
    const { sources } = fixture({ "docs/A.md": DOC, "docs/B.md": DOC }, "warden-stale-");
    build(db, sources, "1.0.0");
    writeFileSync((sources[1] as SourceDoc).file, `${DOC}\nAnd more.\n`, "utf-8");

    const state = freshness(db, sources, "1.0.0");

    expect(state).toMatchObject({ fresh: false, rebuild: false, stale: ["docs/B.md"] });
    db.close();
  });

  it("stays fresh when only the mtime moved — a checkout must not rebuild the corpus", () => {
    const db = openDatabase(":memory:");
    const { sources } = fixture({ "docs/A.md": DOC }, "warden-touch-");
    build(db, sources, "1.0.0");
    const later = new Date(Date.now() + 60_000);
    utimesSync((sources[0] as SourceDoc).file, later, later);

    expect(freshness(db, sources, "1.0.0").fresh).toBe(true);
    db.close();
  });
});

describe("advisory()", () => {
  it("says nothing when the index is current", () => {
    expect(advisory({ fresh: true, rebuild: false, stale: [], reason: "" })).toBe("");
  });

  it("names what changed, capped so a large delta is still one readable line", () => {
    const stale = ["a", "b", "c", "d", "e", "f"];

    expect(advisory({ fresh: false, rebuild: false, stale, reason: "6 documents changed" })).toBe(
      "index is behind the corpus — 6 documents changed: a, b, c, d, e, …",
    );
  });
});
