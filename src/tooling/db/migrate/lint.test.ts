import { describe, expect, it } from "bun:test";

import { sha256 } from "../digest";
import { formatComposeHeader, formatCustomHeader, parseMigrationHeader } from "../schema/header";
import type { LintFinding, Migration } from "../types";
import { formatLintFinding, lintMigration, lintMigrations, lintStatements, splitSqlStatements } from "./lint";

const brief = (findings: readonly LintFinding[]) => findings.map((f) => [f.rule, f.level, f.line]);

describe("splitSqlStatements()", () => {
  it("consumes a trigger body as one statement", () => {
    const sql = "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = 1 WHERE id = NEW.id; DELETE FROM b WHERE id = 1; END;\nSELECT 1;";
    expect(splitSqlStatements(sql).map((s) => s.raw.trim().slice(0, 14))).toEqual(["CREATE TRIGGER", "SELECT 1"]);
  });

  it("does not close a trigger at a CASE expression's END", () => {
    const sql = "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = CASE WHEN NEW.y > 0 THEN 1 ELSE 0 END; END;\nSELECT 1;";
    expect(splitSqlStatements(sql).map((s) => s.raw.trim().slice(0, 14))).toEqual(["CREATE TRIGGER", "SELECT 1"]);
  });

  it("masks a literal semicolon inside a view and a quoted identifier", () => {
    const statements = splitSqlStatements(`CREATE VIEW v AS SELECT 'a;b' AS x, "delete from" AS y FROM t;`);
    expect(statements.length).toBe(1);
    expect(statements[0]?.masked).toBe("CREATE VIEW v AS SELECT       AS x,               AS y FROM t");
  });

  it("keeps the offset of each statement", () => {
    expect(splitSqlStatements("A;\nB;").map((s) => s.offset)).toEqual([0, 2]);
  });
});

describe("lintMigration() — flagged", () => {
  const flagged: [string, string, [string, string, number][]][] = [
    ["drop-no-if-exists on a table", "DROP TABLE users;", [["drop-no-if-exists", "error", 1]]],
    ["drop-no-if-exists on an index", "DROP INDEX users_email;", [["drop-no-if-exists", "error", 1]]],
    ["drop-no-if-exists on a view", "DROP VIEW v;", [["drop-no-if-exists", "error", 1]]],
    ["drop-no-if-exists on a trigger", "DROP TRIGGER t;", [["drop-no-if-exists", "error", 1]]],
    ["unbounded-update", "UPDATE users SET active = 0;", [["unbounded-update", "error", 1]]],
    ["unbounded-delete", "DELETE FROM users;", [["unbounded-delete", "error", 1]]],
    ["unbounded-update behind a CTE's WHERE", "WITH x AS (SELECT 1 WHERE 1) UPDATE users SET flag = 1;", [["unbounded-update", "error", 1]]],
    ["unbounded-delete behind a CTE's WHERE", "WITH x AS (SELECT 1 WHERE 1) DELETE FROM users;", [["unbounded-delete", "error", 1]]],
    ["virtual-table", "CREATE VIRTUAL TABLE docs USING fts5(body);", [["virtual-table", "error", 1]]],
    ["autoincrement", "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT);", [["autoincrement", "error", 1]]],
    [
      "explicit-transaction",
      "BEGIN;\nSELECT 1;\nCOMMIT;",
      [
        ["explicit-transaction", "error", 1],
        ["explicit-transaction", "error", 3],
      ],
    ],
    ["attach-database", "ATTACH DATABASE 'x' AS y;", [["attach-database", "error", 1]]],
    ["add-column-not-null-no-default", "ALTER TABLE users ADD COLUMN email TEXT NOT NULL;", [["add-column-not-null-no-default", "error", 1]]],
    [
      "add-column-non-constant-default",
      "ALTER TABLE users ADD COLUMN at INTEGER DEFAULT CURRENT_TIMESTAMP;",
      [["add-column-non-constant-default", "error", 1]],
    ],
    [
      "add-column-non-constant-default (expression)",
      "ALTER TABLE users ADD COLUMN at INTEGER DEFAULT (unixepoch());",
      [["add-column-non-constant-default", "error", 1]],
    ],
    ["add-column-constrained", "ALTER TABLE users ADD COLUMN code TEXT UNIQUE;", [["add-column-constrained", "error", 1]]],
    ["alter-column-unsupported", "ALTER TABLE users ALTER COLUMN age TYPE TEXT;", [["alter-column-unsupported", "error", 1]]],
    ["drop-column", "ALTER TABLE users DROP COLUMN nickname;", [["drop-column", "warning", 1]]],
    ["rename", "ALTER TABLE users RENAME TO people;", [["rename", "warning", 1]]],
    ["rename column", "ALTER TABLE users RENAME COLUMN a TO b;", [["rename", "warning", 1]]],
    ["unique-index-on-existing-table", "CREATE UNIQUE INDEX users_email ON users (email);", [["unique-index-on-existing-table", "warning", 1]]],
    ["table-rebuild", 'CREATE TABLE "_forge_new_users" (id INTEGER);', [["table-rebuild", "warning", 1]]],
    ["pragma-ignored", "PRAGMA foreign_keys = OFF;", [["pragma-ignored", "warning", 1]]],
    [
      "unique-index-on-existing-table for a table this file rebuilds with its rows copied back",
      [
        'CREATE TABLE "_forge_new_users" (id INTEGER PRIMARY KEY, email TEXT);',
        'INSERT INTO "_forge_new_users" (id, email) SELECT id, email FROM "users";',
        'DROP TABLE "users";',
        'ALTER TABLE "_forge_new_users" RENAME TO "users";',
        "CREATE UNIQUE INDEX users_email ON users (email);",
      ].join("\n"),
      [
        ["table-rebuild", "warning", 1],
        ["unique-index-on-existing-table", "warning", 5],
      ],
    ],
  ];

  for (const [name, sql, expected] of flagged) {
    it(`reports ${name}`, () => {
      expect(brief(lintMigration("m.sql", sql).filter((f) => f.rule !== "custom-ddl"))).toEqual(expected);
    });
  }

  it("reports custom-ddl under a forge:custom stamp and in a file carrying no stamp", () => {
    const ddl = "CREATE TABLE t (id INTEGER PRIMARY KEY);";
    expect(brief(lintMigration("m.sql", `${formatCustomHeader()}${ddl}`))).toEqual([["custom-ddl", "error", 3]]);
    expect(brief(lintMigration("m.sql", ddl))).toEqual([["custom-ddl", "error", 1]]);
  });

  it("reports generated-edited when the body no longer hashes to the stamp", () => {
    const header = formatComposeHeader({ desired: { app: "d" }, baseline: "b", forge: "0" }, "SELECT 1;");
    expect(brief(lintMigration("m.sql", `${header}SELECT 2;`))).toEqual([["generated-edited", "error", 2]]);
    expect(lintMigration("m.sql", `${header}SELECT 1;`)).toEqual([]);
    expect(brief(lintMigration("m.sql", `-- edited notice\n${header.split("\n")[1] ?? ""}\nSELECT 1;`))).toEqual([
      ["generated-edited", "error", 2],
    ]);
    expect(sha256(`${header.split("\n")[0] ?? ""}\n-- forge:compose \nSELECT 1;`)).toContain(header.split('"body":"')[1]?.slice(0, 64));
  });

  it("reports generated-edited when the notice line is deleted, leaving the stamp on line 0", () => {
    const header = formatComposeHeader({ desired: { app: "d" }, baseline: "b", forge: "0" }, "SELECT 1;");
    const sql = `${header.split("\n")[1] ?? ""}\nSELECT 1;`;

    expect(parseMigrationHeader(sql).origin).toBe("generated");
    expect(brief(lintMigration("m.sql", sql))).toEqual([["generated-edited", "error", 2]]);
  });

  it("reports generated-edited for a single byte appended after the body", () => {
    const header = formatComposeHeader({ desired: { app: "d" }, baseline: "b", forge: "0" }, "SELECT 1;");
    expect(brief(lintMigration("m.sql", `${header}SELECT 1;\n`))).toEqual([["generated-edited", "error", 2]]);
  });

  it("treats __new_ as an ordinary table name and only _forge_new_ as a rebuild", () => {
    const rebuild = (prefix: string) =>
      [`CREATE TABLE ${prefix}users (id INTEGER);`, "DROP TABLE users;", `ALTER TABLE ${prefix}users RENAME TO users;`].join("\n");

    expect(brief(lintMigration("m.sql", rebuild("__new_")))).toEqual([
      ["custom-ddl", "error", 1],
      ["drop-no-if-exists", "error", 2],
      ["custom-ddl", "error", 2],
      ["rename", "warning", 3],
      ["custom-ddl", "error", 3],
    ]);
    expect(brief(lintMigration("m.sql", rebuild("_forge_new_")))).toEqual([
      ["table-rebuild", "warning", 1],
      ["custom-ddl", "error", 1],
      ["custom-ddl", "error", 2],
      ["custom-ddl", "error", 3],
    ]);
  });
});

describe("lintMigration() — clean", () => {
  const clean: [string, string][] = [
    ["DROP TABLE IF EXISTS", "DROP TABLE IF EXISTS users;"],
    ["DROP INDEX IF EXISTS", "DROP INDEX IF EXISTS i;"],
    ["a bounded UPDATE", "UPDATE users SET active = 0 WHERE id = 1;"],
    ["a bounded DELETE", "DELETE FROM users WHERE id = 1;"],
    ["ADD COLUMN NOT NULL with a DEFAULT", "ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';"],
    ["ADD COLUMN with a constant DEFAULT", "ALTER TABLE users ADD COLUMN n INTEGER DEFAULT 0;"],
    ["NOT NULL inside a CREATE TABLE", "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);"],
    ["a plain CREATE TABLE", "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY) STRICT;"],
    ["an ordinary INSERT", "INSERT INTO users (id) VALUES (1);"],
    ["an upsert's DO UPDATE SET", "INSERT INTO users (id, n) VALUES (1, 0) ON CONFLICT (id) DO UPDATE SET n = excluded.n;"],
    ["a trigger whose body says BEGIN and END", "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = 1 WHERE id = NEW.id; END;"],
    [
      "a trigger whose body ends in a CASE expression",
      "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = CASE WHEN NEW.y > 0 THEN 1 ELSE 0 END; END;",
    ],
    [
      "a trigger whose UPDATE names no WHERE, bounded by the row that fired it",
      "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = 1; END;",
    ],
    [
      "a UNIQUE index on a table this file creates",
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);\nCREATE UNIQUE INDEX users_email ON users (email);",
    ],
    [
      "a UNIQUE index on a table this file rebuilds without copying a row into it",
      'CREATE TABLE "_forge_new_users" (id INTEGER PRIMARY KEY, email TEXT);\nDROP TABLE "users";\nALTER TABLE "_forge_new_users" RENAME TO "users";\nCREATE UNIQUE INDEX users_email ON users (email);'.replace(
        'CREATE TABLE "_forge_new_users"',
        '-- rebuild\nCREATE TABLE "_forge_new_users"',
      ),
    ],
    ["PRAGMA defer_foreign_keys", "PRAGMA defer_foreign_keys = true;"],
    [
      "a rebuild's DROP TABLE and RENAME",
      'CREATE TABLE "_forge_new_users" (id INTEGER);\nDROP TABLE "users";\nALTER TABLE "_forge_new_users" RENAME TO "users";',
    ],
    ["ATTACH inside a comment", "-- ATTACH DATABASE 'x' AS y;\nSELECT 1;"],
  ];

  for (const [name, sql] of clean) {
    it(`says nothing about ${name}`, () => {
      const findings = lintMigration("m.sql", sql).filter((f) => f.rule !== "table-rebuild" && f.rule !== "custom-ddl");
      expect(findings).toEqual([]);
    });
  }

  it("ignores a line comment, a block comment, a string literal and a quoted identifier", () => {
    const sql = [
      "-- DROP TABLE users;",
      "/* DELETE FROM users;",
      "   UPDATE users SET a = 1; */",
      "INSERT INTO notes (body) VALUES ('DROP TABLE users');",
      'SELECT "delete from" FROM t;',
    ].join("\n");
    expect(lintMigration("m.sql", sql)).toEqual([]);
  });

  it("numbers a finding by its line in the original file, comments included", () => {
    const sql = ["-- a note", "", "/* two", "   lines */", "DROP INDEX users_email;"].join("\n");
    expect(brief(lintMigration("m.sql", sql))).toEqual([["drop-no-if-exists", "error", 5]]);
  });

  it("keeps a WHERE in one statement from excusing an unbounded one in the next", () => {
    const sql = "DELETE FROM users WHERE id = 1;\nDELETE FROM sessions;";
    expect(brief(lintMigration("m.sql", sql))).toEqual([["unbounded-delete", "error", 2]]);
  });

  it("sees a statement spread over several lines and names the offending line", () => {
    const sql = ["UPDATE users", "   SET active = 0;"].join("\n");
    expect(brief(lintMigration("m.sql", sql))).toEqual([["unbounded-update", "error", 1]]);
  });

  it("does not read an escaped quote as the end of a literal", () => {
    expect(lintMigration("m.sql", "INSERT INTO notes (body) VALUES ('it''s DROP TABLE users');")).toEqual([]);
  });

  it("reports every rule one statement breaks, in rule order", () => {
    const sql = "ALTER TABLE users DROP COLUMN a, ADD COLUMN b TEXT NOT NULL, ALTER COLUMN c;";
    expect(brief(lintMigration("m.sql", sql))).toEqual([
      ["add-column-not-null-no-default", "error", 1],
      ["alter-column-unsupported", "error", 1],
      ["drop-column", "warning", 1],
      ["custom-ddl", "error", 1],
    ]);
  });

  it("carries the file it was given into every finding", () => {
    expect(lintMigration("/m/0001_init.sql", "DROP INDEX users_email;")).toEqual([
      {
        rule: "drop-no-if-exists",
        level: "error",
        file: "/m/0001_init.sql",
        line: 1,
        message: "DROP without IF EXISTS fails the whole migration when the object is already gone — write DROP … IF EXISTS",
      },
    ]);
  });

  it("finds nothing in an empty file", () => {
    expect(lintMigration("m.sql", "")).toEqual([]);
  });
});

describe("lintStatements()", () => {
  it("runs only the named rules, at the level it is given", () => {
    const sql = "PRAGMA foreign_keys = OFF;\nDELETE FROM users;\nUPDATE users SET x = 1;";
    expect(lintStatements("s.sql", sql, { rules: ["unbounded-delete"], level: "warning" })).toEqual([
      { rule: "unbounded-delete", level: "warning", file: "s.sql", line: 2, message: "DELETE with no WHERE empties the table" },
    ]);
  });

  it("numbers a finding by its line exactly as lintMigration does", () => {
    const sql = "-- a comment\n\nSELECT 1;\nUPDATE users\n  SET x = 1;";
    const subset = lintStatements("s.sql", sql, { rules: ["unbounded-update"], level: "error" });
    expect(subset.map((f) => f.line)).toEqual([4]);
    expect(subset).toEqual(lintMigration("s.sql", sql).filter((f) => f.rule === "unbounded-update"));
  });

  it("finds nothing when no rule is named", () => {
    expect(lintStatements("s.sql", "DELETE FROM users;", { rules: [], level: "error" })).toEqual([]);
  });
});

describe("lintMigrations()", () => {
  it("names each finding by the migration's path, in migration order", () => {
    const migrations = [
      { name: "0001_init", version: 1, path: "/m/0001_init.sql", sha256: "a", sql: "DROP INDEX users_email;" },
      { name: "0002_next", version: 2, path: "/m/0002_next.sql", sha256: "b", sql: "DELETE FROM users;" },
    ] as Migration[];
    expect(lintMigrations(migrations).map((f) => [f.file, f.rule])).toEqual([
      ["/m/0001_init.sql", "drop-no-if-exists"],
      ["/m/0002_next.sql", "unbounded-delete"],
    ]);
  });

  it("is empty for no migrations", () => {
    expect(lintMigrations([])).toEqual([]);
  });
});

describe("formatLintFinding()", () => {
  it("is one line: level, file:line, rule, message", () => {
    expect(formatLintFinding({ rule: "drop-column", level: "warning", file: "m.sql", line: 3, message: "x" })).toBe(
      "warning m.sql:3 drop-column — x",
    );
  });
});
