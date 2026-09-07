import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { COLUMN_WEIGHTS, INDEXER_VERSION, SCHEMA, SCHEMA_VERSION, TOKENIZE } from "./schema";

describe("SCHEMA", () => {
  it("applies whole to a fresh database", () => {
    const db = new Database(":memory:");

    expect(() => db.exec(SCHEMA)).not.toThrow();
    expect(
      db
        .query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name),
    ).toContain("chunk");
  });
});

describe("TOKENIZE", () => {
  const db = new Database(":memory:");
  db.run(`CREATE VIRTUAL TABLE t USING fts5(a, tokenize = "${TOKENIZE}")`);
  db.run("INSERT INTO t VALUES (?)", ["When to Throw vs Return Result ui/core forge-ui-focus-ring @y-core/forge/ui/show §5c"]);
  const matches = (query: string) => db.query<{ c: number }>("SELECT count(*) AS c FROM t WHERE t MATCH ?").get(`"${query}"`)?.c ?? 0;

  it("keeps a slashed, hyphenated or sectioned identifier as one term", () => {
    expect(matches("ui/core")).toBe(1);
    expect(matches("forge-ui-focus-ring")).toBe(1);
    expect(matches("@y-core/forge/ui/show")).toBe(1);
    expect(matches("§5c")).toBe(1);
  });

  it("stems, so a reader asking about `returning` reaches a section titled `Return`", () => {
    expect(matches("returning")).toBe(1);
    expect(matches("throws")).toBe(1);
  });

  it("does not match a term the document never carries", () => {
    expect(matches("§5d")).toBe(0);
    expect(matches("assertions")).toBe(0);
  });
});

describe("COLUMN_WEIGHTS", () => {
  it("carries one weight per FTS column, rules highest", () => {
    expect(COLUMN_WEIGHTS).toHaveLength(5);
    expect(Math.max(...COLUMN_WEIGHTS)).toBe(COLUMN_WEIGHTS[3]);
  });
});

describe("versions", () => {
  it("are plain strings, so a mismatch is a rebuild rather than a migration", () => {
    expect(SCHEMA_VERSION).toMatch(/^\d+$/);
    expect(INDEXER_VERSION).toMatch(/^\d+$/);
  });
});
