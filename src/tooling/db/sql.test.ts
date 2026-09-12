import { describe, expect, it } from "bun:test";

import { quoteSqlIdentifier, quoteSqlLiteral, rowCountSelect, tableInfoSelect, toColumnInfo } from "./sql";

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
