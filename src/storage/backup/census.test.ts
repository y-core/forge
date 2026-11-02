import { describe, expect, it } from "bun:test";

import { fakeDatabase, stubDatabase } from "./backup.fixture";
import { hasRealAffinity, hazardSelect, isDumpedObject, readSchemaRow, SCHEMA_SELECT, schemaDigest, takeD1Census } from "./census";
import { D1BackupError } from "./errors";

const MIGRATIONS = "CREATE TABLE _forge_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL);";

async function digestOf(schema: string): Promise<string> {
  const db = fakeDatabase(schema);
  return schemaDigest((await db.prepare(SCHEMA_SELECT).all()).results.map(readSchemaRow));
}

describe("isDumpedObject()", () => {
  it("skips Cloudflare's and SQLite's own objects, keeping sqlite_sequence and the app's", () => {
    expect([
      isDumpedObject("users", "users"),
      isDumpedObject("sqlite_sequence", "sqlite_sequence"),
      isDumpedObject("_cf_KV", "_cf_KV"),
      isDumpedObject("idx", "_cf_KV"),
      isDumpedObject("sqlite_stat1", "sqlite_stat1"),
    ]).toEqual([true, true, false, false, false]);
  });
});

describe("hasRealAffinity()", () => {
  it("follows SQLite's affinity precedence", () => {
    expect(["REAL", "DOUBLE PRECISION", "FLOAT", "FLOATING POINT", "INTEGER", "", "TEXT", "NUMERIC"].map(hasRealAffinity)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("hazardSelect()", () => {
  it("counts, per column, an escape beside its control character, a wide integer, and an integral REAL outside REAL affinity", () => {
    const select = hazardSelect("notes", [
      { name: "id", real: true },
      { name: "body", real: false },
    ]);
    expect(select).toContain(
      `SUM(typeof("body") = 'text' AND ((instr("body", char(92) || 'n') > 0 AND instr("body", char(10)) > 0) OR (instr("body", char(92) || 'r') > 0 AND instr("body", char(13)) > 0))) AS "escape:body"`,
    );
    expect(select).toContain(`SUM(typeof("body") = 'real' AND "body" = CAST("body" AS INTEGER)) AS "real:body"`);
    expect(select).not.toContain('"real:id"');
    expect(select.endsWith(' FROM "notes"')).toBe(true);
  });

  it("leaves out the REAL count for a column with REAL affinity, and quotes every name", () => {
    const sql = hazardSelect('we"ird', [{ name: "r", real: true }]);
    expect([sql.includes("real:r"), sql.includes('FROM "we""ird"')]).toEqual([false, true]);
  });
});

describe("schemaDigest()", () => {
  it("is the same for a table created as D1's dumper recreates it, since SQLite drops IF NOT EXISTS", async () => {
    expect(await digestOf('CREATE TABLE IF NOT EXISTS "t" (a TEXT); CREATE INDEX t_a ON t (a);')).toBe(
      await digestOf('CREATE TABLE "t" (a TEXT); CREATE INDEX t_a ON t (a);'),
    );
  });

  it("changes when a column changes", async () => {
    expect(await digestOf("CREATE TABLE t (a TEXT);")).not.toBe(await digestOf("CREATE TABLE t (a TEXT, b TEXT);"));
  });

  it("ignores the objects D1's dumper skips", async () => {
    expect(await digestOf("CREATE TABLE t (a); CREATE TABLE _cf_KV (k);")).toBe(await digestOf("CREATE TABLE t (a);"));
  });
});

describe("takeD1Census()", () => {
  it("reads the migration head as the last recorded migration", async () => {
    const db = fakeDatabase(`${MIGRATIONS} INSERT INTO _forge_migrations (name) VALUES ('0001_init.sql'), ('0002_users.sql');`);
    expect((await takeD1Census(db)).migrationHead).toBe("0002_users.sql");
  });

  it("answers no migration head without the table or with it empty", async () => {
    expect((await takeD1Census(fakeDatabase("CREATE TABLE t (a);"))).migrationHead).toBeNull();
    expect((await takeD1Census(fakeDatabase(MIGRATIONS))).migrationHead).toBeNull();
  });

  it("counts each value D1's dumper would not reproduce, by table, column and kind", async () => {
    const db = fakeDatabase(
      "CREATE TABLE notes (body TEXT, n INTEGER, x); INSERT INTO notes VALUES ('a' || char(10) || 'b\\n', 9007199254740993, 2.0), ('plain', 1, 2.5);",
    );
    expect((await takeD1Census(db)).hazards).toEqual([
      { table: "notes", column: "body", kind: "escape", count: 1 },
      { table: "notes", column: "n", kind: "integer", count: 1 },
      { table: "notes", column: "x", kind: "real", count: 1 },
    ]);
  });

  it("records a table it could not scan as unscanned, rather than failing the backup", async () => {
    const db = fakeDatabase("CREATE TABLE t (a);");
    const failing = {
      batch: db.batch,
      prepare: (query: string) =>
        query.startsWith("SELECT SUM") ? { ...db.prepare(query), all: async () => Promise.reject(new Error("D1 timeout")) } : db.prepare(query),
    };
    expect((await takeD1Census(failing)).hazards).toEqual([{ table: "t", column: null, kind: "unscanned", count: 0 }]);
  });

  it("scans every table at once, keeping schema order and marking only the failing table unscanned", async () => {
    const db = fakeDatabase(
      "CREATE TABLE a (n INTEGER); CREATE TABLE b (n INTEGER); CREATE TABLE c (n INTEGER); INSERT INTO a VALUES (9007199254740993); INSERT INTO c VALUES (9007199254740993), (-9007199254740993);",
    );
    let lastStarted: () => void = () => {};
    const lastScan = new Promise<void>((resolve) => (lastStarted = resolve));
    const concurrent = {
      batch: db.batch,
      prepare: (query: string) => {
        const statement = db.prepare(query);
        if (query.includes("pragma_table_info('a')")) return { ...statement, all: async () => lastScan.then(() => statement.all()) };
        if (query.includes("pragma_table_info('b')")) return { ...statement, all: async () => Promise.reject(new Error("D1 timeout")) };
        if (query.includes("pragma_table_info('c')")) lastStarted();
        return statement;
      },
    };
    expect((await takeD1Census(concurrent)).hazards).toEqual([
      { table: "a", column: "n", kind: "integer", count: 1 },
      { table: "b", column: null, kind: "unscanned", count: 0 },
      { table: "c", column: "n", kind: "integer", count: 2 },
    ]);
  });

  it("refuses a virtual table, naming it", async () => {
    const db = stubDatabase([{ type: "table", name: "docs", tbl_name: "docs", sql: "CREATE VIRTUAL TABLE docs USING fts5(b)" }]);
    const error = (await takeD1Census(db).catch((thrown: unknown) => thrown)) as D1BackupError;
    expect([error instanceof D1BackupError, error.kind, error.message.endsWith("docs")]).toEqual([true, "unsupported", true]);
  });
});
