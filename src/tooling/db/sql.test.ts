import { describe, expect, it } from "bun:test";

import { isReadOnlyBatch, quoteSqlIdentifier, quoteSqlLiteral, rowCountSelect, tableInfoSelect, toColumnInfo } from "./sql";

describe("quoteSqlLiteral()", () => {
  it("wraps a string in single quotes and doubles the ones inside it", () => {
    const cases: [string, string][] = [
      ["plain", "'plain'"],
      ["it's", "'it''s'"],
      ["''", "''''''"],
      ["", "''"],
      ["line\nbreak", "'line\nbreak'"],
      ['double "quoted"', `'double "quoted"'`],
    ];
    for (const [input, expected] of cases) expect(quoteSqlLiteral(input)).toBe(expected);
  });

  it("prints a finite number unquoted", () => {
    expect(quoteSqlLiteral(0)).toBe("0");
    expect(quoteSqlLiteral(-12)).toBe("-12");
    expect(quoteSqlLiteral(1.5)).toBe("1.5");
  });

  it("refuses a NUL byte and a non-finite number", () => {
    expect(() => quoteSqlLiteral("a\0b")).toThrow("a NUL byte cannot appear in a SQL string literal");
    expect(() => quoteSqlLiteral(Number.NaN)).toThrow("NaN is not a finite number and has no SQL literal");
    expect(() => quoteSqlLiteral(Number.POSITIVE_INFINITY)).toThrow("Infinity is not a finite number and has no SQL literal");
    expect(() => quoteSqlLiteral(2 ** 53 + 2)).toThrow("the integer 9007199254740994 is past 2^53 and cannot round-trip as a literal");
  });
});

describe("quoteSqlIdentifier()", () => {
  it("wraps a name in double quotes and doubles the ones inside it", () => {
    expect(quoteSqlIdentifier("d1_migrations")).toBe('"d1_migrations"');
    expect(quoteSqlIdentifier('od"d')).toBe('"od""d"');
    expect(quoteSqlIdentifier("drop table t; --")).toBe('"drop table t; --"');
  });

  it("refuses an empty name and a NUL byte", () => {
    expect(() => quoteSqlIdentifier("")).toThrow("an empty string is not a SQL identifier");
    expect(() => quoteSqlIdentifier("a\0b")).toThrow("a NUL byte cannot appear in a SQL identifier");
  });
});

describe("tableInfoSelect()", () => {
  it("quotes the table as a literal, because pragma_table_info takes a name as a value", () => {
    expect(tableInfoSelect("users")).toBe(`SELECT cid, name, type, "notnull", dflt_value, pk FROM pragma_table_info('users') ORDER BY cid`);
    expect(tableInfoSelect("it's")).toBe(`SELECT cid, name, type, "notnull", dflt_value, pk FROM pragma_table_info('it''s') ORDER BY cid`);
  });
});

describe("toColumnInfo()", () => {
  it("numbers the flag columns and keeps an absent default as null", () => {
    expect(toColumnInfo([{ cid: 0, name: "id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 }])).toEqual([
      { cid: 0, name: "id", type: "INTEGER", notnull: 1, dfltValue: null, pk: 1 },
    ]);
    expect(toColumnInfo([{ cid: 1, name: "kind", type: "TEXT", notnull: 0, dflt_value: "'a'", pk: 0 }])).toEqual([
      { cid: 1, name: "kind", type: "TEXT", notnull: 0, dfltValue: "'a'", pk: 0 },
    ]);
  });
});

describe("rowCountSelect()", () => {
  it("quotes the table as an identifier", () => {
    expect(rowCountSelect("users")).toBe('SELECT COUNT(*) AS rows FROM "users"');
  });
});

describe("isReadOnlyBatch()", () => {
  it("accepts each read form, after leading comments and whitespace", () => {
    const reads = [
      "SELECT name FROM sqlite_master",
      "  \n select 1",
      "-- why\n/* and how */ SELECT 1",
      "EXPLAIN QUERY PLAN SELECT * FROM t",
      "WITH r AS (SELECT 1) SELECT * FROM r",
      'WITH r AS (SELECT "delete" FROM t) SELECT * FROM r',
      "WITH r AS (SELECT 'update me') SELECT * FROM r",
      "PRAGMA table_info('users')",
      'PRAGMA main.table_xinfo("users")',
      "PRAGMA foreign_key_check",
      "PRAGMA quick_check",
    ];
    expect(reads.filter((sql) => !isReadOnlyBatch([sql]))).toEqual([]);
  });

  it("refuses each write form, including DDL that is a no-op when the object exists", () => {
    const writes = [
      "INSERT INTO t VALUES (1)",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "REPLACE INTO t VALUES (1)",
      "CREATE TABLE IF NOT EXISTS _forge_migrations (id INTEGER PRIMARY KEY)",
      "DROP TABLE t",
      "ALTER TABLE t ADD COLUMN b",
      "BEGIN",
      "VACUUM",
      "PRAGMA foreign_keys = ON",
      "PRAGMA user_version = 3",
      "PRAGMA optimize",
      "PRAGMA journal_mode",
      "",
    ];
    expect(writes.filter((sql) => isReadOnlyBatch([sql]))).toEqual([]);
  });

  it("refuses a write behind a leading comment that names a read", () => {
    expect(isReadOnlyBatch(["-- SELECT 1\nDELETE FROM t"])).toBe(false);
    expect(isReadOnlyBatch(["/* SELECT */ INSERT INTO t VALUES (1)"])).toBe(false);
  });

  it("refuses a CTE that writes, whichever write it is", () => {
    const ctes = ["INSERT INTO t SELECT * FROM r", "UPDATE t SET a = 1", "DELETE FROM t", "REPLACE INTO t SELECT * FROM r"].map(
      (write) => `WITH r AS (SELECT 1) ${write}`,
    );
    expect(ctes.filter((sql) => isReadOnlyBatch([sql]))).toEqual([]);
  });

  it("refuses a batch mixing a read with a write, and an empty batch", () => {
    expect([isReadOnlyBatch(["SELECT 1", "DELETE FROM t"]), isReadOnlyBatch([]), isReadOnlyBatch(["SELECT 1", "SELECT 2"])]).toEqual([
      false,
      false,
      true,
    ]);
  });
});
