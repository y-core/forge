import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build } from "../index/build";
import { openDatabase } from "../index/db";
import type { SourceDoc } from "../types";
import { related, unresolved } from "./related";

function write(root: string, path: string, source: string): string {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf-8");
  return file;
}

function doc(title: string, header: string, body: string): string {
  return `---\ntitle: ${title}\ndescription: "One."\n---\n\n${header}\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\n${body}\n`;
}

const root = mkdtempSync(join(tmpdir(), "warden-related-"));
const sources: SourceDoc[] = [
  {
    corpus: "canon",
    tree: "libs",
    path: "CODE_RULES.md",
    // Defers back, so the pair is mutual — the shape that emitted one physical row twice.
    file: write(root, "CODE_RULES.md", doc("Rules", "> Defers to: [`TESTING.md`](./docs/TESTING.md) §1 for the gate.", "Body.")),
    weight: 1.3,
  },
  {
    corpus: "project",
    path: "docs/TESTING.md",
    file: write(
      root,
      "docs/TESTING.md",
      doc("Testing", "> Defers to: `CODE_RULES.md` §5c for the budget.", "See `CODE_RULES.md` §5c, and `ABSENT.md` §1."),
    ),
    weight: 1.2,
  },
];

const db = openDatabase(":memory:");
build(db, sources, "1.0.0");

describe("related()", () => {
  it("returns what a section cites, resolved to a chunk id", () => {
    expect(related(db, "project:docs/TESTING.md#1", ["cites"])).toEqual([
      { kind: "cites", raw: "ABSENT.md §1" },
      { kind: "cites", id: "canon:CODE_RULES.md#5c", raw: "CODE_RULES.md §5c" },
    ]);
  });

  it("reaches a document-level `defers` edge from any section of that document, resolved to the section its prose names", () => {
    expect(related(db, "project:docs/TESTING.md#1", ["defers"])).toEqual([
      { kind: "defers", id: "canon:CODE_RULES.md#5c", raw: "CODE_RULES.md §5c" },
    ]);
  });

  it("resolves a `defers` written as a markdown link once, not once per spelling", () => {
    expect(related(db, "canon:CODE_RULES.md#1", ["defers"])).toEqual([
      { kind: "defers", id: "project:docs/TESTING.md#1", raw: "docs/TESTING.md §1" },
    ]);
  });

  it("answers the inbound question too — what else depends on this rule", () => {
    expect(related(db, "canon:CODE_RULES.md#5c", ["defers-by"]).map((edge) => edge.id)).toEqual(["project:docs/TESTING.md"]);
  });

  it("emits a mutual edge once, however many times the walk reaches it", () => {
    const edges = related(db, "project:docs/TESTING.md#1", undefined, 3);
    const keys = edges.map((edge) => `${edge.kind}|${edge.id ?? ""}|${edge.raw}`);
    expect(keys).toEqual([...new Set(keys)]);
  });

  it("returns nothing for an id nothing touches", () => {
    expect(related(db, "canon:NOTHING.md#1")).toEqual([]);
  });
});

describe("unresolved()", () => {
  it("keeps a citation that resolved to nothing, with the spelling the document wrote", () => {
    expect(unresolved(db)).toEqual([{ kind: "cites", id: "project:docs/TESTING.md#1", raw: "ABSENT.md §1" }]);
  });
});
