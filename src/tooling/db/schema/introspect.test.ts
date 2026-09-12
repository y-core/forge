import { describe, expect, it } from "bun:test";

import { assembleSchemaModel, describeSchemaDifference, schemaModelSelects, schemaTablesEqual } from "./introspect";
import type { SchemaModel } from "./types";

const USERS = "CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  -- the address\n  email TEXT NOT NULL,\n  CHECK (length(email) < 254)\n) STRICT";
const POSTS = "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, body TEXT)";

/** The five reads' rows for the two-table schema above. */
export function twoTableRows() {
  return {
    inventory: [
      { type: "index", name: "posts_user", tbl_name: "posts", sql: "CREATE INDEX posts_user ON posts (user_id)" },
      { type: "index", name: "sqlite_autoindex_users_1", tbl_name: "users", sql: null },
      { type: "table", name: "_cf_KV", tbl_name: "_cf_KV", sql: "CREATE TABLE _cf_KV (k TEXT)" },
      { type: "table", name: "d1_migrations", tbl_name: "d1_migrations", sql: "CREATE TABLE d1_migrations (id INTEGER)" },
      { type: "table", name: "posts", tbl_name: "posts", sql: POSTS },
      { type: "table", name: "users", tbl_name: "users", sql: USERS },
      {
        type: "trigger",
        name: "trg",
        tbl_name: "posts",
        sql: "CREATE TRIGGER trg AFTER INSERT ON posts BEGIN UPDATE posts SET body = '' WHERE id = NEW.id; END",
      },
      { type: "view", name: "v", tbl_name: "v", sql: "CREATE VIEW v AS SELECT id FROM users" },
    ],
    columns: [
      { tbl: "posts", cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1, hidden: 0 },
      { tbl: "posts", cid: 1, name: "user_id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0, hidden: 0 },
      { tbl: "posts", cid: 2, name: "body", type: "TEXT", notnull: 0, dflt_value: null, pk: 0, hidden: 0 },
      { tbl: "users", cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1, hidden: 0 },
      { tbl: "users", cid: 1, name: "email", type: "TEXT", notnull: 1, dflt_value: null, pk: 0, hidden: 0 },
    ],
    indexList: [{ tbl: "posts", idx: "posts_user", unique: 0, partial: 0 }],
    indexColumns: [{ idx: "posts_user", seqno: 0, col: "user_id" }],
    foreignKeys: [{ tbl: "posts", id: 0, seq: 0, parent: "users", from: "user_id", to: "id", on_update: "NO ACTION", on_delete: "CASCADE" }],
  };
}

describe("assembleSchemaModel()", () => {
  const model = assembleSchemaModel(twoTableRows());

  it("builds every table with its columns in three forms, its constraints, options and foreign keys", () => {
    expect(model.tables.map((table) => table.name)).toEqual(["posts", "users"]);
    const users = model.tables[1];
    expect(users?.columns.map((column) => [column.name, column.definition, column.definitionSource, column.notnull, column.pk])).toEqual([
      ["id", "ID INTEGER PRIMARY KEY", "id INTEGER PRIMARY KEY", false, 1],
      ["email", "EMAIL TEXT NOT NULL", "email TEXT NOT NULL", true, 0],
    ]);
    expect(users?.constraints).toEqual(["CHECK(LENGTH(EMAIL) < 254)"]);
    expect(users?.strict).toBe(true);
    expect(model.tables[0]?.foreignKeys).toEqual([{ table: "users", from: ["user_id"], to: ["id"], onUpdate: "NO ACTION", onDelete: "CASCADE" }]);
  });

  it("keeps named indexes with their columns, drops autoindexes, and leaves the managed tables out", () => {
    expect(model.indexes).toEqual([
      {
        name: "posts_user",
        table: "posts",
        unique: false,
        partial: false,
        columns: ["user_id"],
        sql: "CREATE INDEX posts_user ON posts (user_id)",
        normalized: "CREATE INDEX POSTS_USER ON POSTS(USER_ID)",
      },
    ]);
  });

  it("reads a quoted keyword as a column, and folds a quoted column name inside its own CHECK", () => {
    const sql = 'CREATE TABLE t (id INTEGER, "unique" TEXT CHECK ("unique" <> \'\'))';
    const rows = {
      ...twoTableRows(),
      inventory: [{ type: "table", name: "t", tbl_name: "t", sql }],
      columns: [
        { tbl: "t", cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0, hidden: 0 },
        { tbl: "t", cid: 1, name: "unique", type: "TEXT", notnull: 0, dflt_value: null, pk: 0, hidden: 0 },
      ],
    };
    expect(assembleSchemaModel(rows).tables[0]?.columns.map((column) => column.definition)).toEqual([
      "ID INTEGER",
      "UNIQUE TEXT CHECK(UNIQUE <> '')",
    ]);
  });

  it("refuses a virtual table", () => {
    const rows = twoTableRows();
    rows.inventory.push({ type: "table", name: "docs", tbl_name: "docs", sql: "CREATE VIRTUAL TABLE docs USING fts5(body)" });
    expect(() => assembleSchemaModel(rows)).toThrow("docs is a virtual table");
  });

  it("refuses a column count the body splitter did not reproduce", () => {
    const rows = twoTableRows();
    rows.columns.push({ tbl: "users", cid: 2, name: "extra", type: "TEXT", notnull: 0, dflt_value: null, pk: 0, hidden: 0 });
    expect(() => assembleSchemaModel(rows)).toThrow("users: 3 columns in pragma_table_xinfo and 2 column clauses");
  });
});

describe("schemaModelSelects()", () => {
  it("filters the engine's, the platform's and forge's tables inside the join, where D1's authorizer requires it", () => {
    const selects = schemaModelSelects("my_migrations");
    for (const select of Object.values(selects)) {
      expect(select).toContain("m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'");
      expect(select).toContain("m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\'");
      expect(select).toContain("m.name <> 'my_migrations'");
    }
    expect(selects.columns).toContain("pragma_table_xinfo(m.name)");
  });
});

describe("comparison", () => {
  const model = assembleSchemaModel(twoTableRows());

  it("compares tables by column definitions in order, the constraint set and the options — never the whole text", () => {
    const users = model.tables[1];
    if (users === undefined) throw new Error("no users");
    expect(
      schemaTablesEqual(users, {
        ...users,
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, CHECK (length(email) < 254)) STRICT",
      }),
    ).toBe(true);
    expect(schemaTablesEqual(users, { ...users, strict: false })).toBe(false);
    expect(schemaTablesEqual(users, { ...users, columns: [...users.columns].reverse() })).toBe(false);
  });

  it("matches names as SQLite resolves them, so a case-only difference is none", () => {
    const shouting: SchemaModel = { ...model, tables: model.tables.map((table) => ({ ...table, name: table.name.toUpperCase() })) };
    expect(describeSchemaDifference(model, shouting, { left: "snapshot", right: "replay" })).toEqual([]);
  });

  it("describes every difference by object and side", () => {
    const other: SchemaModel = { ...model, views: [], indexes: [{ ...(model.indexes[0] as SchemaModel["indexes"][number]), normalized: "X" }] };
    expect(describeSchemaDifference(model, other, { left: "snapshot", right: "replay" })).toEqual([
      "index posts_user: differs between snapshot and replay",
      "view v: in snapshot, not in replay",
    ]);
  });
});
