import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { composed } from "../db.fixture";
import { sha256 } from "../digest";
import { diffSchemaModels } from "../schema/diff";
import { emitMigrationSql } from "../schema/emit";
import { formatComposeHeader, parseMigrationHeader } from "../schema/header";
import { assembleSchemaModel, schemaModelSelects } from "../schema/introspect";
import type { SchemaModel } from "../schema/types";
import type { LintFinding, Migration } from "../types";
import { formatLintFinding, lintMigration, lintMigrations, lintStatements, splitSqlStatements } from "./lint";

const brief = (findings: readonly LintFinding[]) => findings.map((f) => [f.rule, f.line]);

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
  const flagged: [string, string, [string, number][]][] = [
    ["drop-no-if-exists on a table", "DROP TABLE users;", [["drop-no-if-exists", 3]]],
    ["drop-no-if-exists on an index", "DROP INDEX users_email;", [["drop-no-if-exists", 3]]],
    ["drop-no-if-exists on a view", "DROP VIEW v;", [["drop-no-if-exists", 3]]],
    ["drop-no-if-exists on a trigger", "DROP TRIGGER t;", [["drop-no-if-exists", 3]]],
    ["unbounded-update", "UPDATE users SET active = 0;", [["unbounded-update", 3]]],
    ["unbounded-delete", "DELETE FROM users;", [["unbounded-delete", 3]]],
    ["unbounded-update behind a CTE's WHERE", "WITH x AS (SELECT 1 WHERE 1) UPDATE users SET flag = 1;", [["unbounded-update", 3]]],
    ["unbounded-delete behind a CTE's WHERE", "WITH x AS (SELECT 1 WHERE 1) DELETE FROM users;", [["unbounded-delete", 3]]],
    ["virtual-table", "CREATE VIRTUAL TABLE docs USING fts5(body);", [["virtual-table", 3]]],
    ["autoincrement", "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT);", [["autoincrement", 3]]],
    [
      "explicit-transaction",
      "BEGIN;\nSELECT 1;\nCOMMIT;",
      [
        ["explicit-transaction", 3],
        ["explicit-transaction", 5],
      ],
    ],
    ["attach-database", "ATTACH DATABASE 'x' AS y;", [["attach-database", 3]]],
    ["add-column-not-null-no-default", "ALTER TABLE users ADD COLUMN email TEXT NOT NULL;", [["add-column-not-null-no-default", 3]]],
    [
      "add-column-non-constant-default",
      "ALTER TABLE users ADD COLUMN at INTEGER DEFAULT CURRENT_TIMESTAMP;",
      [["add-column-non-constant-default", 3]],
    ],
    [
      "add-column-non-constant-default (expression)",
      "ALTER TABLE users ADD COLUMN at INTEGER DEFAULT (unixepoch());",
      [["add-column-non-constant-default", 3]],
    ],
    ["add-column-constrained", "ALTER TABLE users ADD COLUMN code TEXT UNIQUE;", [["add-column-constrained", 3]]],
    ["alter-column-unsupported", "ALTER TABLE users ALTER COLUMN age TYPE TEXT;", [["alter-column-unsupported", 3]]],
  ];

  for (const [name, sql, expected] of flagged) {
    it(`reports ${name}`, () => {
      expect(brief(lintMigration("m.sql", composed(sql)))).toEqual(expected);
    });
  }

  // Each verdict is wrangler's local D1 adding the column to a table holding one row.
  const refusingNull = (sql: string) => brief(lintMigration("m.sql", composed(sql)).filter((f) => f.rule === "add-column-not-null-no-default"));

  const refusedOnRows: [string, string][] = [
    ["NOT NULL", "a TEXT NOT NULL"], // refused: "Cannot add a NOT NULL column with default value NULL"
    ["DEFAULT NULL NOT NULL", "a TEXT DEFAULT NULL NOT NULL"], // refused
    ["CHECK (col IS NOT NULL)", "a TEXT CHECK (a IS NOT NULL)"], // refused: "CHECK constraint failed"
    ["CHECK (NOT col IS NULL)", "a TEXT CHECK (NOT a IS NULL)"], // refused
  ];

  for (const [name, column] of refusedOnRows) {
    it(`reports ADD COLUMN … ${name} with no non-NULL DEFAULT, which D1 refuses on a populated table`, () => {
      expect(refusingNull(`ALTER TABLE t ADD COLUMN ${column};`)).toEqual([["add-column-not-null-no-default", 3]]);
    });
  }

  const acceptedOnRows: [string, string][] = [
    ["CHECK (col IS NOT NULL OR other IS NULL)", "a TEXT CHECK (a IS NOT NULL OR kind IS NULL)"], // accepted
    ["a CASE that admits every row", "a TEXT CHECK (CASE WHEN a IS NOT NULL THEN 1 ELSE 1 END)"], // accepted
    ["NOT NULL DEFAULT 'x' CHECK (col IS NOT NULL)", "a TEXT NOT NULL DEFAULT 'x' CHECK (a IS NOT NULL)"], // accepted
    ["a CHECK holding another column NOT NULL", "a TEXT CHECK (kind IS NOT NULL)"],
    ["NOT NULL inside a parenthesised DEFAULT", "a INTEGER DEFAULT (1 NOT NULL)"],
    ["NOT NULL inside a generated column's expression", "a INTEGER AS (kind NOT NULL)"],
  ];

  for (const [name, column] of acceptedOnRows) {
    it(`passes ADD COLUMN … ${name} under add-column-not-null-no-default`, () => {
      expect(refusingNull(`ALTER TABLE t ADD COLUMN ${column};`)).toEqual([]);
    });
  }

  it("reads the column's message as the populated table it fails on", () => {
    expect(lintMigration("m.sql", composed("ALTER TABLE t ADD COLUMN a TEXT CHECK (a IS NOT NULL);"))[0]?.message).toBe(
      "ADD COLUMN of a column that refuses NULL, with no non-NULL DEFAULT, fails on any table that already has rows — add it nullable or with a constant DEFAULT",
    );
  });

  const judgedByEffect: [string, string][] = [
    ["a DROP COLUMN", "ALTER TABLE users DROP COLUMN nickname;"],
    ["a table rename", "ALTER TABLE users RENAME TO people;"],
    ["a column rename", "ALTER TABLE users RENAME COLUMN a TO b;"],
    ["a UNIQUE index on a table that already exists", "CREATE UNIQUE INDEX users_email ON users (email);"],
    [
      "a rebuild that copies its rows back and indexes them UNIQUE",
      [
        'CREATE TABLE "_forge_new_users" (id INTEGER PRIMARY KEY, email TEXT);',
        'INSERT INTO "_forge_new_users" (id, email) SELECT id, email FROM "users";',
        'DROP TABLE "users";',
        'ALTER TABLE "_forge_new_users" RENAME TO "users";',
        "CREATE UNIQUE INDEX users_email ON users (email);",
      ].join("\n"),
    ],
  ];

  for (const [name, sql] of judgedByEffect) {
    it(`reports nothing for ${name}, which the analysis or a rehearsal judges instead`, () => {
      expect(lintMigration("m.sql", composed(sql))).toEqual([]);
    });
  }

  const unstamped: [string, string][] = [
    ["DDL", "CREATE TABLE t (id INTEGER PRIMARY KEY);"],
    ["a data-only INSERT", "INSERT INTO t (id) VALUES (1);"],
    ["a first line of prose", "-- Migration 0001: the users table\nCREATE TABLE t (id INTEGER PRIMARY KEY);"],
    ["nothing at all", ""],
  ];

  for (const [name, sql] of unstamped) {
    it(`reports generated-edited on line 1 for a file with no compose stamp holding ${name}, and nothing once it is composed`, () => {
      expect(brief(lintMigration("m.sql", sql))).toEqual([["generated-edited", 1]]);
      expect(lintMigration("m.sql", composed(sql))).toEqual([]);
    });
  }

  it("tells the developer to compose a file with no stamp", () => {
    expect(lintMigration("m.sql", "SELECT 1;")[0]?.message).toContain("`forge db migrate compose` writes every migration");
  });

  it("reports generated-edited when the body no longer hashes to the stamp", () => {
    const header = formatComposeHeader({ desired: { app: "d" }, baseline: "b", forge: "0" }, "SELECT 1;");
    expect(brief(lintMigration("m.sql", `${header}SELECT 2;`))).toEqual([["generated-edited", 2]]);
    expect(lintMigration("m.sql", `${header}SELECT 1;`)).toEqual([]);
    expect(brief(lintMigration("m.sql", `-- edited notice\n${header.split("\n")[1] ?? ""}\nSELECT 1;`))).toEqual([["generated-edited", 2]]);
    expect(sha256(`${header.split("\n")[0] ?? ""}\n-- forge:compose \nSELECT 1;`)).toContain(header.split('"body":"')[1]?.slice(0, 64));
  });

  it("reports generated-edited when the stamp is not JSON, as a body that no longer hashes", () => {
    expect(brief(lintMigration("m.sql", "-- Generated\n-- forge:compose {not json\nSELECT 1;"))).toEqual([["generated-edited", 2]]);
  });

  it("reports generated-edited when the notice line is deleted, leaving the stamp on line 0", () => {
    const header = formatComposeHeader({ desired: { app: "d" }, baseline: "b", forge: "0" }, "SELECT 1;");
    const sql = `${header.split("\n")[1] ?? ""}\nSELECT 1;`;

    expect(parseMigrationHeader(sql).stamp).not.toBe(null);
    expect(brief(lintMigration("m.sql", sql))).toEqual([["generated-edited", 2]]);
  });

  it("reports generated-edited for a single byte appended after the body", () => {
    const header = formatComposeHeader({ desired: { app: "d" }, baseline: "b", forge: "0" }, "SELECT 1;");
    expect(brief(lintMigration("m.sql", `${header}SELECT 1;\n`))).toEqual([["generated-edited", 2]]);
  });

  it("treats __new_ as an ordinary table name and only _forge_new_ as a rebuild", () => {
    const rebuild = (prefix: string) =>
      [`CREATE TABLE ${prefix}users (id INTEGER);`, "DROP TABLE users;", `ALTER TABLE ${prefix}users RENAME TO users;`].join("\n");

    expect(brief(lintMigration("m.sql", composed(rebuild("__new_"))))).toEqual([["drop-no-if-exists", 4]]);
    expect(lintMigration("m.sql", composed(rebuild("_forge_new_")))).toEqual([]);
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
    [
      "a rebuild's DROP TABLE and RENAME",
      'CREATE TABLE "_forge_new_users" (id INTEGER);\nDROP TABLE "users";\nALTER TABLE "_forge_new_users" RENAME TO "users";',
    ],
    ["ATTACH inside a comment", "-- ATTACH DATABASE 'x' AS y;\nSELECT 1;"],
  ];

  for (const [name, sql] of clean) {
    it(`says nothing about ${name}`, () => {
      expect(lintMigration("m.sql", composed(sql))).toEqual([]);
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
    expect(lintMigration("m.sql", composed(sql))).toEqual([]);
  });

  it("numbers a finding by its line in the original file, comments included", () => {
    const sql = ["-- a note", "", "/* two", "   lines */", "DROP INDEX users_email;"].join("\n");
    expect(brief(lintMigration("m.sql", composed(sql)))).toEqual([["drop-no-if-exists", 7]]);
  });

  it("keeps a WHERE in one statement from excusing an unbounded one in the next", () => {
    const sql = "DELETE FROM users WHERE id = 1;\nDELETE FROM sessions;";
    expect(brief(lintMigration("m.sql", composed(sql)))).toEqual([["unbounded-delete", 4]]);
  });

  it("sees a statement spread over several lines and names the offending line", () => {
    const sql = ["UPDATE users", "   SET active = 0;"].join("\n");
    expect(brief(lintMigration("m.sql", composed(sql)))).toEqual([["unbounded-update", 3]]);
  });

  it("does not read an escaped quote as the end of a literal", () => {
    expect(lintMigration("m.sql", composed("INSERT INTO notes (body) VALUES ('it''s DROP TABLE users');"))).toEqual([]);
  });

  it("reports every rule one statement breaks, in rule order", () => {
    const sql = "ALTER TABLE users DROP COLUMN a, ADD COLUMN b TEXT NOT NULL, ALTER COLUMN c;";
    expect(brief(lintMigration("m.sql", composed(sql)))).toEqual([
      ["add-column-not-null-no-default", 3],
      ["alter-column-unsupported", 3],
    ]);
  });

  it("carries the file it was given into every finding", () => {
    expect(lintMigration("/m/0001_init.sql", composed("DROP INDEX users_email;"))).toEqual([
      {
        rule: "drop-no-if-exists",
        file: "/m/0001_init.sql",
        line: 3,
        message: "DROP without IF EXISTS fails the whole migration when the object is already gone — write DROP … IF EXISTS",
      },
    ]);
  });

  it("finds nothing in an empty composed file, and refuses an empty file with no stamp", () => {
    expect(lintMigration("m.sql", composed(""))).toEqual([]);
    expect(brief(lintMigration("m.sql", ""))).toEqual([["generated-edited", 1]]);
  });
});

describe("lintMigration() — pragma-unsupported", () => {
  const honoured = [
    "table_list",
    "table_info(users)",
    "table_xinfo(users)",
    "index_list(users)",
    "index_info(users_email)",
    "index_xinfo(users_email)",
    "quick_check",
    "foreign_key_check",
    "foreign_key_list(users)",
    "case_sensitive_like = true",
    "ignore_check_constraints = false",
    "legacy_alter_table = false",
    "recursive_triggers = true",
    "reverse_unordered_selects = false",
    "optimize",
    "defer_foreign_keys = true",
    "main.table_info(users)",
  ];
  for (const pragma of honoured) {
    it(`allows PRAGMA ${pragma}`, () => {
      expect(lintMigration("m.sql", composed(`PRAGMA ${pragma};`))).toEqual([]);
    });
  }

  for (const pragma of ["foreign_keys = OFF", "foreign_keys = ON", "foreign_keys", "FOREIGN_KEYS=0"]) {
    it(`refuses PRAGMA ${pragma}, which D1 ignores`, () => {
      const findings = lintMigration("m.sql", composed(`PRAGMA ${pragma};`));
      expect(brief(findings)).toEqual([["pragma-unsupported", 3]]);
      expect(findings[0]?.message).toContain("always enforces foreign keys");
    });
  }

  const refused = [
    "journal_mode = WAL",
    "synchronous = OFF",
    "cache_size = 100",
    "user_version = 3",
    "integrity_check",
    "busy_timeout = 100",
    "temp_store = MEMORY",
    "mmap_size",
    "schema_version",
    "application_id",
    "wal_checkpoint",
    "analysis_limit = 100",
  ];
  for (const pragma of refused) {
    it(`refuses PRAGMA ${pragma}`, () => {
      expect(brief(lintMigration("m.sql", composed(`PRAGMA ${pragma};`)))).toEqual([["pragma-unsupported", 3]]);
    });
  }
});

describe("lintMigration() — table-too-wide", () => {
  const table = (columns: number, extra = "") =>
    `CREATE TABLE wide (${Array.from({ length: columns }, (_, i) => `c${i} INTEGER`).join(", ")}${extra});`;
  const wide = (sql: string) => brief(lintMigration("m.sql", sql).filter((f) => f.rule === "table-too-wide"));

  it("passes a table of exactly 100 columns, and does not count a table constraint as one", () => {
    expect(wide(table(100))).toEqual([]);
    expect(wide(table(100, ", PRIMARY KEY (c0), CHECK (c1 > 0)"))).toEqual([]);
  });

  it("refuses a table of 101 columns, on the line its CREATE starts", () => {
    expect(wide(`-- wide\n${table(101)}`)).toEqual([["table-too-wide", 2]]);
  });

  it("says nothing about a table created AS SELECT, whose columns it cannot count", () => {
    expect(wide("CREATE TABLE copy AS SELECT * FROM users;")).toEqual([]);
  });
});

describe("lintMigration() — auth-key-blocks-delete", () => {
  const blocked = (sql: string) => brief(lintMigration("m.sql", composed(sql)).filter((f) => f.rule === "auth-key-blocks-delete"));
  const table = (body: string) => `CREATE TABLE notes (id INTEGER PRIMARY KEY, ${body});`;

  const refused: [string, string][] = [
    ["a column key with no ON DELETE clause", table("user_id BLOB REFERENCES auth_users (id)")],
    ["a column key with ON DELETE NO ACTION", table("user_id BLOB REFERENCES auth_users (id) ON DELETE NO ACTION")],
    ["a column key with ON DELETE RESTRICT", table("user_id BLOB REFERENCES auth_users (id) ON DELETE RESTRICT")],
    ["a column key with ON DELETE SET DEFAULT", table("user_id BLOB DEFAULT x'00' REFERENCES auth_users (id) ON DELETE SET DEFAULT")],
    ["a column key with ON DELETE SET NULL on a NOT NULL column", table("user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE SET NULL")],
    ["a column key naming no parent column", table("user_id BLOB REFERENCES auth_users ON DELETE RESTRICT")],
    ["a column key whose only action is ON UPDATE CASCADE", table("user_id BLOB REFERENCES auth_users (id) ON UPDATE CASCADE")],
    ["ON UPDATE CASCADE before ON DELETE RESTRICT", table("user_id BLOB REFERENCES auth_users (id) ON UPDATE CASCADE ON DELETE RESTRICT")],
    ["a DEFERRABLE key with no ON DELETE clause", table("user_id BLOB REFERENCES auth_users (id) DEFERRABLE INITIALLY DEFERRED")],
    ["a DEFAULT literal that spells ON DELETE CASCADE", table("user_id BLOB DEFAULT 'ON DELETE CASCADE' REFERENCES auth_users (id)")],
    ["a table key with no ON DELETE clause", table("user_id BLOB, FOREIGN KEY (user_id) REFERENCES auth_users (id)")],
    [
      "a named table key with ON DELETE RESTRICT",
      table("user_id BLOB, CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES auth_users (id) ON DELETE RESTRICT"),
    ],
    [
      "a composite key with ON DELETE SET NULL and one NOT NULL column",
      table("user_id BLOB NOT NULL, session_id TEXT, FOREIGN KEY (user_id, session_id) REFERENCES auth_sessions (user_id, id) ON DELETE SET NULL"),
    ],
    ["a double-quoted parent in another case", table('user_id BLOB REFERENCES "AUTH_Users" (id)')],
    ["a bracketed parent", table("user_id BLOB REFERENCES [auth_users] (id)")],
    ["a backquoted parent", table("user_id BLOB REFERENCES `auth_users` (id)")],
    ["a bare parent in mixed case", table("user_id BLOB references Auth_Users (id) on delete restrict")],
    ["a quoted child table and column", 'CREATE TABLE IF NOT EXISTS "notes" ("user_id" BLOB REFERENCES auth_users (id));'],
    ["an added column with no ON DELETE clause", "ALTER TABLE notes ADD COLUMN user_id BLOB REFERENCES auth_users (id);"],
    [
      "an added column with no COLUMN keyword and ON DELETE SET DEFAULT",
      "ALTER TABLE notes ADD user_id BLOB REFERENCES auth_users (id) ON DELETE SET DEFAULT;",
    ],
  ];

  for (const [name, sql] of refused) {
    it(`refuses ${name}`, () => {
      expect(blocked(sql)).toEqual([["auth-key-blocks-delete", 3]]);
    });
  }

  it("refuses an added NOT NULL column whose key sets null", () => {
    const sql = "ALTER TABLE notes ADD COLUMN user_id BLOB NOT NULL DEFAULT x'00' REFERENCES auth_users (id) ON DELETE SET NULL;";
    expect(blocked(sql)).toEqual([["auth-key-blocks-delete", 3]]);
  });

  const passed: [string, string][] = [
    ["a column key with ON DELETE CASCADE", table("user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE")],
    ["a column key with ON DELETE SET NULL on a nullable column", table("user_id BLOB REFERENCES auth_users (id) ON DELETE SET NULL")],
    ["ON DELETE CASCADE beside ON UPDATE RESTRICT", table("user_id BLOB REFERENCES auth_users (id) ON UPDATE RESTRICT ON DELETE CASCADE")],
    ["a DEFERRABLE key with ON DELETE CASCADE", table("user_id BLOB REFERENCES auth_users (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED")],
    ["a table key with ON DELETE CASCADE", table("user_id BLOB NOT NULL, FOREIGN KEY (user_id) REFERENCES auth_users (id) ON DELETE CASCADE")],
    [
      "a composite key with ON DELETE SET NULL on nullable columns",
      table("user_id BLOB, session_id TEXT, FOREIGN KEY (user_id, session_id) REFERENCES auth_sessions (user_id, id) ON DELETE SET NULL"),
    ],
    ["a quoted mixed-case parent with ON DELETE CASCADE", table('user_id BLOB REFERENCES "Auth_Users" (id) ON DELETE CASCADE')],
    ["an added column with ON DELETE CASCADE", "ALTER TABLE notes ADD COLUMN user_id BLOB REFERENCES auth_users (id) ON DELETE CASCADE;"],
    ["a key to a table that is not forge's auth", table("user_id INTEGER REFERENCES users (id)")],
    ["a key to a table whose name only begins with auth", table("author_id INTEGER REFERENCES authors (id) ON DELETE RESTRICT")],
    ["a key commented out of the column", "CREATE TABLE notes (\n  user_id BLOB -- REFERENCES auth_users (id)\n);"],
    ["a CREATE TABLE inside a comment", "-- CREATE TABLE notes (user_id BLOB REFERENCES auth_users (id));\nSELECT 1;"],
    ["a CREATE TABLE inside a string", "INSERT INTO notes (body) VALUES ('CREATE TABLE x (u BLOB REFERENCES auth_users (id))');"],
    ["an ALTER TABLE inside a string", "INSERT INTO notes (body) VALUES ('ALTER TABLE x ADD COLUMN u BLOB REFERENCES auth_users (id)');"],
    ["a table created AS SELECT", "CREATE TABLE copy AS SELECT * FROM auth_users;"],
  ];

  for (const [name, sql] of passed) {
    it(`passes ${name}`, () => {
      expect(blocked(sql)).toEqual([]);
    });
  }

  it("reports each refused key in a table, on the line its key starts", () => {
    const sql = [
      "CREATE TABLE notes (",
      "  id INTEGER PRIMARY KEY,",
      "  author BLOB REFERENCES auth_users (id),",
      "  editor BLOB REFERENCES auth_users (id) ON DELETE CASCADE,",
      "  session_id TEXT,",
      "  FOREIGN KEY (session_id) REFERENCES auth_sessions (id) ON DELETE RESTRICT",
      ");",
    ].join("\n");
    expect(blocked(sql)).toEqual([
      ["auth-key-blocks-delete", 5],
      ["auth-key-blocks-delete", 8],
    ]);
  });

  it("names the table, the columns, the parent, what is wrong and the fix", () => {
    const messages = (sql: string) => lintMigration("m.sql", composed(sql)).map((f) => f.message);
    expect(messages(table("user_id BLOB REFERENCES auth_users (id)"))).toEqual([
      "notes (user_id) references auth_users with no ON DELETE clause, which is NO ACTION, so D1 refuses the delete of an auth_users row " +
        "that purgeAuthEphemera or an admin remove makes — declare ON DELETE CASCADE, or ON DELETE SET NULL on a nullable column",
    ]);
    expect(messages(table("a BLOB NOT NULL, b TEXT, FOREIGN KEY (a, b) REFERENCES auth_sessions (user_id, id) ON DELETE SET NULL"))[0]).toStartWith(
      "notes (a, b) references auth_sessions with ON DELETE SET NULL on a, which cannot hold NULL, so D1 refuses",
    );
    expect(messages(table("user_id BLOB REFERENCES auth_users (id) ON DELETE SET DEFAULT"))[0]).toStartWith(
      "notes (user_id) references auth_users with ON DELETE SET DEFAULT, so",
    );
  });

  const setNull = (body: string, options = "") => `CREATE TABLE notes (${body})${options};`;
  const SID_KEY = "FOREIGN KEY (sid) REFERENCES auth_sessions (id) ON DELETE SET NULL";

  const unnullable: [string, string][] = [
    ["a column PRIMARY KEY in a STRICT table", setNull("sid BLOB PRIMARY KEY REFERENCES auth_sessions (id) ON DELETE SET NULL", " STRICT")],
    [
      "a column PRIMARY KEY in a WITHOUT ROWID table",
      setNull("sid TEXT PRIMARY KEY REFERENCES auth_sessions (id) ON DELETE SET NULL", " WITHOUT ROWID"),
    ],
    ["a column PRIMARY KEY in a rowid table", setNull("sid TEXT PRIMARY KEY REFERENCES auth_sessions (id) ON DELETE SET NULL")],
    ["an INTEGER PRIMARY KEY", setNull("uid INTEGER PRIMARY KEY REFERENCES auth_users (id) ON DELETE SET NULL")],
    ["a table PRIMARY KEY in a STRICT table", setNull(`sid BLOB, n INTEGER, PRIMARY KEY (sid, n), ${SID_KEY}`, " STRICT")],
    ["a table PRIMARY KEY in a WITHOUT ROWID table", setNull(`sid TEXT, n INTEGER, PRIMARY KEY (n, "sid"), ${SID_KEY}`, " WITHOUT ROWID")],
    ["a named table PRIMARY KEY", setNull(`sid TEXT, CONSTRAINT pk PRIMARY KEY (sid), ${SID_KEY}`)],
    ["a table CHECK (col IS NOT NULL)", setNull(`id INTEGER PRIMARY KEY, sid TEXT, CHECK (sid IS NOT NULL), ${SID_KEY}`)],
    ["a table CHECK (col NOTNULL) on a quoted name", setNull(`id INTEGER PRIMARY KEY, sid TEXT, CHECK ("sid" NOTNULL), ${SID_KEY}`)],
    ["a named table CHECK (col NOT NULL)", setNull(`id INTEGER PRIMARY KEY, sid TEXT, CONSTRAINT c CHECK (sid NOT NULL), ${SID_KEY}`)],
    [
      "a column PRIMARY KEY under a constraint name",
      setNull("sid TEXT CONSTRAINT pk PRIMARY KEY REFERENCES auth_sessions (id) ON DELETE SET NULL"),
    ],
    [
      "a quoted column in another case, with COLLATE and DESC, in a table PRIMARY KEY",
      setNull(`n INTEGER, sid TEXT, PRIMARY KEY ("SID" COLLATE NOCASE DESC, n), ${SID_KEY}`, " WITHOUT ROWID"),
    ],
    [
      "a qualified column a table CHECK holds NOT NULL across comments",
      setNull(`id INTEGER PRIMARY KEY, sid TEXT, CHECK (notes.sid /* held */ IS /* always */ NOT NULL), ${SID_KEY}`),
    ],
    ["a table CHECK (NOT col IS NULL)", setNull(`id INTEGER PRIMARY KEY, sid TEXT, CHECK (NOT sid IS NULL), ${SID_KEY}`)],
    [
      "a parenthesised conjunct of a table CHECK",
      setNull(`id INTEGER PRIMARY KEY, sid TEXT, n INTEGER, CHECK ((sid IS NOT NULL) AND n > 0), ${SID_KEY}`),
    ],
    [
      "a CHECK on another column holding the key column NOT NULL",
      setNull(`id INTEGER PRIMARY KEY, sid TEXT, n INTEGER CHECK (sid IS NOT NULL), ${SID_KEY}`),
    ],
  ];

  for (const [name, sql] of unnullable) {
    it(`refuses ON DELETE SET NULL on ${name}, which cannot hold NULL`, () => {
      expect(blocked(sql)).toEqual([["auth-key-blocks-delete", 3]]);
      expect(lintMigration("m.sql", composed(sql))[0]?.message).toContain("which cannot hold NULL");
    });
  }

  const nullable: [string, string][] = [
    [
      "a STRICT table keyed on another column",
      setNull("id INTEGER PRIMARY KEY, sid BLOB REFERENCES auth_sessions (id) ON DELETE SET NULL", " STRICT"),
    ],
    ["a WITHOUT ROWID table keyed on another column", setNull(`id TEXT, sid TEXT, PRIMARY KEY (id), ${SID_KEY}`, " WITHOUT ROWID")],
    [
      "a table CHECK that holds another column NOT NULL",
      setNull(`id INTEGER PRIMARY KEY, sid TEXT, body TEXT, CHECK (body IS NOT NULL), ${SID_KEY}`),
    ],
    ["a table CHECK that admits NULL", setNull(`id INTEGER PRIMARY KEY, sid TEXT, CHECK (sid IS NULL OR length(sid) = 16), ${SID_KEY}`)],
    ["a table UNIQUE on the key column", setNull(`id INTEGER PRIMARY KEY, sid TEXT, UNIQUE (sid), ${SID_KEY}`)],
    [
      "a DEFAULT literal that spells PRIMARY KEY",
      setNull("id INTEGER PRIMARY KEY, sid TEXT DEFAULT 'PRIMARY KEY' REFERENCES auth_sessions (id) ON DELETE SET NULL"),
    ],
    [
      "a table whose generated column reads the key column NOT NULL",
      setNull("id INTEGER PRIMARY KEY, sid TEXT REFERENCES auth_sessions (id) ON DELETE SET NULL, linked INTEGER AS (sid NOTNULL)"),
    ],
    [
      "a CHECK whose CASE names the key column NOT NULL but admits every row",
      setNull(`id INTEGER PRIMARY KEY, sid TEXT, CHECK (CASE WHEN sid IS NOT NULL THEN 1 ELSE 1 END), ${SID_KEY}`),
    ],
    [
      "a column CHECK that holds another column NOT NULL",
      setNull(
        "id INTEGER PRIMARY KEY, kind TEXT, sid TEXT CHECK (kind IS NOT NULL OR sid IS NULL) REFERENCES auth_sessions (id) ON DELETE SET NULL",
      ),
    ],
    ["a CHECK whose OR admits NULL", setNull(`id INTEGER PRIMARY KEY, sid TEXT, kind TEXT, CHECK (sid IS NOT NULL OR kind IS NULL), ${SID_KEY}`)],
    [
      "a CHECK conjunct joined by OR",
      setNull(`id INTEGER PRIMARY KEY, sid TEXT, n INTEGER, CHECK (sid IS NOT NULL AND n > 0 OR n = 0), ${SID_KEY}`),
    ],
    // A CHECK refusing NULL another way is out of the lint's reach: the purge's runtime `blocked` floor reports it.
    ["a CHECK refusing NULL through typeof()", setNull(`id INTEGER PRIMARY KEY, sid TEXT, CHECK (typeof(sid) = 'text'), ${SID_KEY}`)],
  ];

  for (const [name, sql] of nullable) {
    it(`passes ON DELETE SET NULL on a nullable column in ${name}`, () => {
      expect(blocked(sql)).toEqual([]);
    });
  }

  it("refuses an added column whose own CHECK holds it NOT NULL and whose key sets null", () => {
    const sql = "ALTER TABLE notes ADD COLUMN sid TEXT CHECK (sid IS NOT NULL) REFERENCES auth_sessions (id) ON DELETE SET NULL;";
    const findings = lintMigration("m.sql", composed(sql)).filter((f) => f.rule === "auth-key-blocks-delete");
    expect({ brief: brief(findings), message: findings[0]?.message.split(", so D1")[0] }).toEqual({
      brief: [["auth-key-blocks-delete", 3]],
      message: "notes (sid) references auth_sessions with ON DELETE SET NULL on sid, which cannot hold NULL",
    });
  });

  it("reads a parent the rebuild renames as the auth table it becomes", () => {
    const rebuilt = (action: string) => `CREATE TABLE "_forge_new_notes" (user_id BLOB REFERENCES "_forge_new_auth_users" (id)${action});`;
    const findings = lintMigration("m.sql", composed(rebuilt("")));
    expect(brief(findings)).toEqual([["auth-key-blocks-delete", 3]]);
    expect(findings[0]?.message).toStartWith("notes (user_id) references auth_users with no ON DELETE clause");
    expect(blocked(rebuilt(" ON DELETE CASCADE"))).toEqual([]);
  });

  it("names a rebuilt table by the name the rebuild gives it", () => {
    const findings = lintMigration("m.sql", composed('CREATE TABLE "_forge_new_notes" (user_id BLOB REFERENCES auth_users (id));'));
    expect(findings[0]?.message).toStartWith("notes (user_id) references auth_users");
  });

  it("passes forge's own auth schema, whose keys to auth tables it does read", () => {
    const schema = readFileSync(fileURLToPath(new URL("../../../auth/schema.sql", import.meta.url)), "utf-8");
    expect(lintStatements("schema.sql", schema, ["auth-key-blocks-delete"])).toEqual([]);
    expect(lintStatements("schema.sql", schema.replaceAll("ON DELETE CASCADE", ""), ["auth-key-blocks-delete"]).length).toBeGreaterThan(0);
  });

  describe("over the migrations compose emits for forge's auth schema", () => {
    const schema = readFileSync(fileURLToPath(new URL("../../../auth/schema.sql", import.meta.url)), "utf-8");
    const FACTOR_KEY = "user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,\n  kind TEXT NOT NULL,";
    const FACTOR_ATTEMPTS = "failed_attempts INTEGER NOT NULL DEFAULT 0,";
    const EMPTY: SchemaModel = { tables: [], indexes: [], triggers: [], views: [] };

    function modelOf(sql: string): SchemaModel {
      const db = new Database(":memory:");
      db.exec(sql);
      const selects = schemaModelSelects();
      const read = (statement: string) => db.query(statement).all() as Record<string, unknown>[];
      const model = assembleSchemaModel({
        inventory: read(selects.inventory),
        columns: read(selects.columns),
        indexList: read(selects.indexList),
        indexColumns: read(selects.indexColumns),
        foreignKeys: read(selects.foreignKeys),
      });
      db.close();
      return model;
    }

    function emitted(baseline: SchemaModel, desired: SchemaModel): string {
      return emitMigrationSql(diffSchemaModels(baseline, desired), baseline, desired);
    }

    it("passes the migration that creates the schema from nothing, and refuses one key per auth child once no key cascades", () => {
      const keys = schema.match(/REFERENCES auth_/g)?.length ?? 0;
      expect({
        cascading: blocked(emitted(EMPTY, modelOf(schema))),
        plain: blocked(emitted(EMPTY, modelOf(schema.replaceAll("ON DELETE CASCADE", "")))).length,
      }).toEqual({ cascading: [], plain: keys });
    });

    it("passes the rebuild of auth_factors, whose replacement still references auth_users, and refuses it once that key stops cascading", () => {
      expect(schema).toContain(FACTOR_KEY);
      const baseline = modelOf(schema);
      const rebuilt = schema.replace(FACTOR_ATTEMPTS, "failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),");
      const cascading = emitted(baseline, modelOf(rebuilt));
      const plain = emitted(
        baseline,
        modelOf(rebuilt.replace(FACTOR_KEY, "user_id BLOB NOT NULL REFERENCES auth_users (id),\n  kind TEXT NOT NULL,")),
      );
      expect({
        rebuildsFactors: cascading.includes('CREATE TABLE "_forge_new_auth_factors"'),
        cascading: blocked(cascading),
        plain: lintMigration("m.sql", composed(plain))
          .filter((f) => f.rule === "auth-key-blocks-delete")
          .map((f) => f.message.split(", so D1")[0]),
      }).toEqual({
        rebuildsFactors: true,
        cascading: [],
        plain: ["auth_factors (user_id) references auth_users with no ON DELETE clause, which is NO ACTION"],
      });
    });
  });
});

describe("lintStatements()", () => {
  it("runs only the named rules", () => {
    const sql = "PRAGMA foreign_keys = OFF;\nDELETE FROM users;\nUPDATE users SET x = 1;";
    expect(lintStatements("s.sql", sql, ["unbounded-delete"])).toEqual([
      { rule: "unbounded-delete", file: "s.sql", line: 2, message: "DELETE with no WHERE empties the table" },
    ]);
  });

  it("numbers a finding by its line exactly as lintMigration does", () => {
    const sql = "-- a comment\n\nSELECT 1;\nUPDATE users\n  SET x = 1;";
    const subset = lintStatements("s.sql", sql, ["unbounded-update"]);
    expect(subset.map((f) => f.line)).toEqual([4]);
    expect(subset).toEqual(lintMigration("s.sql", sql).filter((f) => f.rule === "unbounded-update"));
  });

  it("finds nothing when no rule is named", () => {
    expect(lintStatements("s.sql", "DELETE FROM users;", [])).toEqual([]);
  });
});

describe("lintMigrations()", () => {
  it("names each finding by the migration's path, in migration order", () => {
    const migrations = [
      { name: "0001_init", version: 1, path: "/m/0001_init.sql", sha256: "a", sql: composed("DROP INDEX users_email;") },
      { name: "0002_next", version: 2, path: "/m/0002_next.sql", sha256: "b", sql: composed("DELETE FROM users;") },
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
  it("is one line: file:line, rule, message", () => {
    expect(formatLintFinding({ rule: "autoincrement", file: "m.sql", line: 3, message: "x" })).toBe("m.sql:3 autoincrement — x");
  });
});
