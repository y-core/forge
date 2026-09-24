import { describe, expect, it } from "bun:test";

import { diffSchemaModels, parseSchemaRename } from "./diff";
import { emitMigrationSql, orderTablesByForeignKeys, rebuildClosure } from "./emit";
import { assembleSchemaModel } from "./introspect";
import { twoTableRows } from "./introspect.test";
import type { SchemaModel, SchemaTable } from "./types";

const baseline = assembleSchemaModel(twoTableRows());
const users = baseline.tables[1] as SchemaTable;
const posts = baseline.tables[0] as SchemaTable;

describe("orderTablesByForeignKeys()", () => {
  it("puts a parent before its child, then name order", () => {
    expect(orderTablesByForeignKeys([posts, users]).map((table) => table.name)).toEqual(["users", "posts"]);
  });

  it("falls back to name order on a cycle", () => {
    const a: SchemaTable = {
      ...users,
      name: "a",
      foreignKeys: [{ table: "b", from: ["id"], to: ["id"], onUpdate: "NO ACTION", onDelete: "NO ACTION" }],
    };
    const b: SchemaTable = {
      ...users,
      name: "b",
      foreignKeys: [{ table: "a", from: ["id"], to: ["id"], onUpdate: "NO ACTION", onDelete: "NO ACTION" }],
    };
    expect(orderTablesByForeignKeys([b, a]).map((table) => table.name)).toEqual(["a", "b"]);
  });
});

describe("rebuildClosure()", () => {
  it("takes every table whose FOREIGN KEY points into the set, transitively", () => {
    expect(rebuildClosure(baseline, ["users"]).sort()).toEqual(["posts", "users"]);
    expect(rebuildClosure(baseline, ["posts"])).toEqual(["posts"]);
  });

  it("matches a root against the baseline without regard to identifier case", () => {
    expect(rebuildClosure(baseline, ["Users"]).sort()).toEqual(["Users", "posts"]);
  });
});

describe("emitMigrationSql()", () => {
  it("emits nothing for an empty diff", () => {
    expect(emitMigrationSql(diffSchemaModels(baseline, baseline), baseline, baseline)).toBe("");
  });

  it("creates tables parents first from the desired DDL, then their indexes and triggers", () => {
    const empty: SchemaModel = { tables: [], indexes: [], triggers: [], views: [] };
    const sql = emitMigrationSql(diffSchemaModels(empty, baseline), empty, baseline);
    expect(sql).toBe(
      [
        "PRAGMA defer_foreign_keys = true;",
        `${users.sql};`,
        `${posts.sql};`,
        "CREATE INDEX posts_user ON posts (user_id);",
        "CREATE TRIGGER trg AFTER INSERT ON posts BEGIN UPDATE posts SET body = '' WHERE id = NEW.id; END;",
        "CREATE VIEW v AS SELECT id FROM users;",
      ].join("\n\n") + "\n",
    );
  });

  it("adds a column with the author's own clause and drops one by name", () => {
    const added = {
      ...(posts.columns[2] as SchemaTable["columns"][number]),
      name: "title",
      definition: "TITLE TEXT DEFAULT 'x'",
      definitionSource: "title TEXT DEFAULT 'x' -- x",
    };
    const desired: SchemaModel = {
      ...baseline,
      tables: [{ ...posts, columns: [posts.columns[0], posts.columns[1], added] as SchemaTable["columns"] }, users],
      triggers: [],
    };
    const base = { ...baseline, triggers: [] };
    const sql = emitMigrationSql(diffSchemaModels(base, desired), base, desired);
    expect(sql).toBe(
      `PRAGMA defer_foreign_keys = true;\n\nALTER TABLE "posts" DROP COLUMN "body";\n\nALTER TABLE "posts" ADD COLUMN title TEXT DEFAULT 'x' -- x;\n`,
    );
  });

  it("copies the rows of a rebuilt table the desired schema spells in another case, rather than none", () => {
    const renamed: SchemaTable = { ...users, name: "Users", strict: false, sql: users.sql.replace(" STRICT", "").replace("users", "Users") };
    const desired: SchemaModel = { ...baseline, tables: [posts, renamed] };
    const sql = emitMigrationSql(diffSchemaModels(baseline, desired), baseline, desired);

    expect(sql).toContain('INSERT INTO "_forge_new_Users" ("id", "email") SELECT "id", "email" FROM "Users";');
  });

  it("rebuilds a parent together with its children, re-pointing each child's REFERENCES, dropping leaves first and renaming parents first", () => {
    const desired: SchemaModel = { ...baseline, tables: [posts, { ...users, strict: false, sql: users.sql.replace(" STRICT", "") }] };
    const sql = emitMigrationSql(diffSchemaModels(baseline, desired), baseline, desired);
    expect(sql).toBe(
      [
        "PRAGMA defer_foreign_keys = true;",
        'DROP VIEW IF EXISTS "v";',
        'DROP TRIGGER IF EXISTS "trg";',
        `CREATE TABLE "_forge_new_users" ${users.sql.slice(users.sql.indexOf("(")).replace(" STRICT", "")};`,
        'INSERT INTO "_forge_new_users" ("id", "email") SELECT "id", "email" FROM "users";',
        'CREATE TABLE "_forge_new_posts" (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES "_forge_new_users"(id) ON DELETE CASCADE, body TEXT);',
        'INSERT INTO "_forge_new_posts" ("id", "user_id", "body") SELECT "id", "user_id", "body" FROM "posts";',
        'DROP TABLE "posts";',
        'DROP TABLE "users";',
        'ALTER TABLE "_forge_new_users" RENAME TO "users";',
        'ALTER TABLE "_forge_new_posts" RENAME TO "posts";',
        "CREATE INDEX posts_user ON posts (user_id);",
        "CREATE TRIGGER trg AFTER INSERT ON posts BEGIN UPDATE posts SET body = '' WHERE id = NEW.id; END;",
        "CREATE VIEW v AS SELECT id FROM users;",
      ].join("\n\n") + "\n",
    );
  });

  it("rebuilds a child without its REFERENCES before the parent it referenced is dropped, so no ON DELETE fires into it", () => {
    const userId = posts.columns[1] as SchemaTable["columns"][number];
    const freed: SchemaTable = {
      ...posts,
      columns: [
        posts.columns[0],
        { ...userId, definition: "USER_ID INTEGER", definitionSource: "user_id INTEGER" },
        posts.columns[2],
      ] as SchemaTable["columns"],
      foreignKeys: [],
      sql: "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, body TEXT)",
    };
    const desired: SchemaModel = { tables: [freed], indexes: [], triggers: [], views: [] };
    const diff = diffSchemaModels(baseline, desired);
    expect(diff.dropDependents).toEqual(["posts"]);
    const statements = emitMigrationSql(diff, baseline, desired).trim().split("\n\n");

    const renamed = statements.indexOf('ALTER TABLE "_forge_new_posts" RENAME TO "posts";');
    const dropped = statements.indexOf('DROP TABLE IF EXISTS "users";');
    expect(renamed).toBeGreaterThan(-1);
    expect(dropped).toBeGreaterThan(renamed);
    expect(statements.includes('CREATE TABLE "_forge_new_posts" (id INTEGER PRIMARY KEY, user_id INTEGER, body TEXT);')).toBe(true);
    expect(statements.includes('INSERT INTO "_forge_new_posts" ("id", "user_id", "body") SELECT "id", "user_id", "body" FROM "posts";')).toBe(true);
  });

  it("drops several tables children first, so a dropped child never cascades into a dropped parent still holding rows", () => {
    const empty: SchemaModel = { tables: [], indexes: [], triggers: [], views: [] };
    const statements = emitMigrationSql(diffSchemaModels(baseline, empty), baseline, empty).trim().split("\n\n");
    expect(statements.indexOf('DROP TABLE IF EXISTS "posts";')).toBeLessThan(statements.indexOf('DROP TABLE IF EXISTS "users";'));
  });

  it("puts renames first, drops a table with IF EXISTS, and replaces a changed index", () => {
    const desired: SchemaModel = {
      tables: [users],
      indexes: [],
      triggers: [],
      views: [{ name: "v", sql: "CREATE VIEW v AS SELECT id, email FROM users", normalized: "X" }],
    };
    const sql = emitMigrationSql(diffSchemaModels(baseline, desired), baseline, desired, [parseSchemaRename("users.email:mail")]);
    expect(sql).toBe(
      [
        "PRAGMA defer_foreign_keys = true;",
        'ALTER TABLE "users" RENAME COLUMN "email" TO "mail";',
        'DROP VIEW IF EXISTS "v";',
        'DROP TRIGGER IF EXISTS "trg";',
        'DROP INDEX IF EXISTS "posts_user";',
        'DROP TABLE IF EXISTS "posts";',
        "CREATE VIEW v AS SELECT id, email FROM users;",
      ].join("\n\n") + "\n",
    );
  });
});
