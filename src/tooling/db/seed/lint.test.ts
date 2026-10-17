import { describe, expect, it } from "bun:test";

import type { Seed } from "../types";
import { lintSeed, lintSeeds, SEED_MIGRATION_RULES } from "./lint";

describe("lintSeed()", () => {
  it("reports a bare INSERT, by line", () => {
    const sql = "INSERT OR IGNORE INTO a (id) VALUES (1);\nINSERT INTO b (id)\n  VALUES (2);";
    expect(lintSeed("s.sql", sql).map((f) => [f.rule, f.line])).toEqual([["seed-insert-not-idempotent", 2]]);
  });

  const clean = [
    "INSERT OR IGNORE INTO a (id) VALUES (1);",
    "INSERT OR REPLACE INTO a (id) VALUES (1);",
    "INSERT INTO a (id) VALUES (1) ON CONFLICT DO NOTHING;",
    "INSERT INTO a (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id = excluded.id;",
    "-- INSERT INTO a (id) VALUES (1);\nUPDATE a SET x = 1 WHERE id = 1;",
  ];
  for (const sql of clean) {
    it(`says nothing about \`${sql.slice(0, 40)}\``, () => {
      expect(lintSeed("s.sql", sql)).toEqual([]);
    });
  }
});

describe("lintSeed() — the migration rules a seed is held to", () => {
  it("names the rules a seed is held to, leaving drops to the schema check", () => {
    expect(SEED_MIGRATION_RULES).toEqual(["unbounded-update", "unbounded-delete", "attach-database"]);
  });

  it("reports an UPDATE with no WHERE", () => {
    expect(lintSeed("s.sql", "UPDATE users SET active = 0;")).toEqual([
      { rule: "unbounded-update", file: "s.sql", line: 1, message: "UPDATE with no WHERE rewrites every row in the table" },
    ]);
  });

  it("reports a DELETE with no WHERE", () => {
    expect(lintSeed("s.sql", "DELETE FROM users;")).toEqual([
      { rule: "unbounded-delete", file: "s.sql", line: 1, message: "DELETE with no WHERE empties the table" },
    ]);
  });

  it("says nothing about a DROP without IF EXISTS, which the schema check refuses", () => {
    expect(lintSeed("s.sql", "DROP TABLE users;")).toEqual([]);
  });

  it("reports ATTACH", () => {
    expect(lintSeed("s.sql", "ATTACH DATABASE 'x' AS y;")).toEqual([
      { rule: "attach-database", file: "s.sql", line: 1, message: "D1 is one database — ATTACH and DETACH are not supported" },
    ]);
  });

  it("says nothing about a bounded DELETE, a DROP IF EXISTS, or a rule outside the set", () => {
    expect(lintSeed("s.sql", "DELETE FROM users WHERE id = 1;")).toEqual([]);
    expect(lintSeed("s.sql", "DROP TABLE IF EXISTS users;")).toEqual([]);
    expect(lintSeed("s.sql", "PRAGMA foreign_keys = OFF;\nCREATE VIRTUAL TABLE f USING fts5(a);")).toEqual([]);
  });

  it("orders findings by line across the seed rule and the migration rules", () => {
    const sql = "DELETE FROM users;\nINSERT INTO users (id) VALUES (1);\nUPDATE users SET x = 1;";
    expect(lintSeed("s.sql", sql).map((f) => [f.rule, f.line])).toEqual([
      ["unbounded-delete", 1],
      ["seed-insert-not-idempotent", 2],
      ["unbounded-update", 3],
    ]);
  });
});

describe("lintSeeds()", () => {
  it("names each finding by the seed's path", () => {
    const seed = { source: "config/seeds", name: "x", path: "/s/x.sql", sha256: "", sql: "INSERT INTO a (id) VALUES (1);", places: null } as Seed;
    expect(lintSeeds([seed]).map((f) => f.file)).toEqual(["/s/x.sql"]);
  });
});
