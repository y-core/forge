import { describe, expect, it } from "bun:test";

import { dropStatements } from "./migrations";

describe("dropStatements()", () => {
  const objects = [
    { type: "table", name: "users" },
    { type: "table", name: "posts" },
    { type: "table", name: "comments" },
    { type: "index", name: "posts_user" },
    { type: "view", name: "v" },
    { type: "trigger", name: "t" },
  ];

  it("drops triggers, views and indexes, then each table before the tables it references", () => {
    const parents = new Map([
      ["posts", ["users"]],
      ["comments", ["posts", "users"]],
    ]);
    expect(dropStatements(objects, parents)).toEqual([
      'DROP TRIGGER IF EXISTS "t"',
      'DROP VIEW IF EXISTS "v"',
      'DROP INDEX IF EXISTS "posts_user"',
      'DROP TABLE IF EXISTS "comments"',
      'DROP TABLE IF EXISTS "posts"',
      'DROP TABLE IF EXISTS "users"',
    ]);
  });

  it("ignores a table's reference to itself, and falls back to name order on a cycle", () => {
    const tables = [
      { type: "table", name: "b" },
      { type: "table", name: "a" },
      { type: "table", name: "tree" },
    ];
    const parents = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
      ["tree", ["tree"]],
    ]);
    expect(dropStatements(tables, parents)).toEqual(['DROP TABLE IF EXISTS "tree"', 'DROP TABLE IF EXISTS "a"', 'DROP TABLE IF EXISTS "b"']);
  });

  it("quotes a name carrying a double quote", () => {
    expect(dropStatements([{ type: "table", name: 'a"b' }], new Map())).toEqual(['DROP TABLE IF EXISTS "a""b"']);
  });
});
