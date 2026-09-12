import { describe, expect, it } from "bun:test";

import { CliError } from "../../cli/errors";
import {
  declaredObjectNames,
  maskSqlProse,
  mentionsSqlIdentifier,
  normalizeDdlText,
  normalizeSqlIdentifier,
  scanSql,
  splitCreateTableBody,
  stripSqlComments,
  unquoteSqlIdentifier,
} from "./normalize";

describe("scanSql()", () => {
  it("cuts comments, literals and quoted identifiers each as one token", () => {
    const kinds = scanSql(`SELECT 'a;b', "c d", [e], \`f\` -- x\n/* y */ FROM t`).map((token) => token.kind);
    expect(kinds).toEqual([
      "word",
      "space",
      "string",
      "punct",
      "space",
      "identifier",
      "punct",
      "space",
      "identifier",
      "punct",
      "space",
      "identifier",
      "space",
      "comment",
      "space",
      "comment",
      "space",
      "word",
      "space",
      "word",
    ]);
  });

  it("keeps a doubled quote inside a literal", () => {
    expect(scanSql("'it''s'").map((token) => token.text)).toEqual(["'it''s'"]);
  });
});

describe("maskSqlProse()", () => {
  it("blanks comments and literals and keeps every newline", () => {
    expect(maskSqlProse("DROP 'x'\n-- DELETE FROM t\nSELECT")).toBe("DROP    \n                \nSELECT");
  });

  it("blanks quoted identifiers only when asked", () => {
    expect(maskSqlProse('SELECT "delete from"')).toBe('SELECT "delete from"');
    expect(maskSqlProse('SELECT "delete from"', { identifiers: true })).toBe("SELECT              ");
  });
});

describe("normalizeDdlText()", () => {
  it("makes a file's statement and the text SQLite stored for it read the same", () => {
    const file = `CREATE TABLE IF NOT EXISTS auth_users (\n  id BLOB PRIMARY KEY NOT NULL, -- the key\n  email TEXT NOT NULL\n) STRICT;`;
    const stored = 'CREATE TABLE "auth_users" (id BLOB PRIMARY KEY NOT NULL, email TEXT NOT NULL) STRICT';
    expect(normalizeDdlText(file)).toBe(normalizeDdlText(stored));
    expect(normalizeDdlText(file)).toBe("CREATE TABLE AUTH_USERS(ID BLOB PRIMARY KEY NOT NULL, EMAIL TEXT NOT NULL) STRICT");
  });

  it("keeps a string literal byte for byte and quotes an identifier that is not simple", () => {
    expect(normalizeDdlText("x text default 'Hello World' , [two words] int")).toBe(`X TEXT DEFAULT 'Hello World', "TWO WORDS" INT`);
  });

  it("leaves a double-quoted token inside DEFAULT or CHECK verbatim, because SQLite may read it as a string", () => {
    expect(normalizeDdlText('x TEXT DEFAULT "abc"')).not.toBe(normalizeDdlText('x TEXT DEFAULT "ABC"'));
    expect(normalizeDdlText('x TEXT DEFAULT "abc"')).toBe('X TEXT DEFAULT "abc"');
    expect(normalizeDdlText('x TEXT CHECK (x <> "abc")')).not.toBe(normalizeDdlText('x TEXT CHECK (x <> "ABC")'));
  });

  it("folds a quoted token inside DEFAULT or CHECK that names one of the table's own columns", () => {
    const columns = new Set(["email"]);
    expect(normalizeDdlText("email TEXT CHECK (\"email\" <> '')", { literals: columns })).toBe(normalizeDdlText("email TEXT CHECK (email <> '')"));
    expect(normalizeDdlText('x TEXT CHECK (x <> "abc")', { literals: columns })).toBe('X TEXT CHECK(X <> "abc")');
  });

  it("keeps every double-quoted token verbatim when asked, since a view or trigger body may read one as a string", () => {
    const admin = 'CREATE VIEW admins AS SELECT id FROM users WHERE role = "admin"';
    expect(normalizeDdlText(admin, { literals: "verbatim" })).not.toBe(
      normalizeDdlText(admin.replace('"admin"', '"Admin"'), { literals: "verbatim" }),
    );
    expect(normalizeDdlText(admin)).toBe(normalizeDdlText(admin.replace('"admin"', '"Admin"')));
  });

  it("spells two quotings of one non-simple name the same, since SQLite resolves them as one", () => {
    expect(normalizeDdlText('"Two Words" INT')).toBe(normalizeDdlText('"two words" INT'));
  });

  it("reads the three quoting styles as one identifier", () => {
    expect(normalizeDdlText('"a"')).toBe(normalizeDdlText("`a`"));
    expect(normalizeDdlText("[a]")).toBe("A");
  });
});

describe("identifiers", () => {
  it("unquotes each style and undoubles the quote", () => {
    expect(unquoteSqlIdentifier('"a""b"')).toBe('a"b');
    expect(unquoteSqlIdentifier("`x`")).toBe("x");
    expect(unquoteSqlIdentifier("[y]")).toBe("y");
    expect(unquoteSqlIdentifier("z")).toBe("z");
  });

  it("spells a simple name bare and upper, and anything else quoted", () => {
    expect(normalizeSqlIdentifier("users")).toBe("USERS");
    expect(normalizeSqlIdentifier("two words")).toBe('"TWO WORDS"');
  });

  it("finds a name only as a whole identifier, bare or quoted in any case", () => {
    expect(mentionsSqlIdentifier("CREATE INDEX I ON T(USER_ID) WHERE ID > 0", "id")).toBe(true);
    expect(mentionsSqlIdentifier("CREATE INDEX I ON T(USER_ID)", "id")).toBe(false);
    expect(mentionsSqlIdentifier('CREATE INDEX I ON T("two words")', "two words")).toBe(true);
    expect(mentionsSqlIdentifier('CREATE TRIGGER T AFTER UPDATE ON "Users" BEGIN SELECT 1; END', "users")).toBe(true);
    expect(mentionsSqlIdentifier("CREATE TRIGGER T AFTER UPDATE ON 'users' BEGIN SELECT 1; END", "users")).toBe(false);
  });
});

describe("stripSqlComments()", () => {
  it("removes comments and collapses whitespace, and leaves the author's text alone", () => {
    expect(stripSqlComments("-- lead\n  email_key   TEXT NOT NULL /* x */")).toBe("email_key TEXT NOT NULL");
  });
});

describe("splitCreateTableBody()", () => {
  it("splits at depth-0 commas and classes each clause", () => {
    const parts = splitCreateTableBody(
      "CREATE TABLE t (\n  id INTEGER PRIMARY KEY,\n  a TEXT DEFAULT (1, 2), -- c\n  CHECK (length(a) < 10),\n  UNIQUE (a, id)\n) STRICT",
    );
    expect(parts.clauses.map((clause) => [clause.kind, clause.normalized])).toEqual([
      ["column", "ID INTEGER PRIMARY KEY"],
      ["column", "A TEXT DEFAULT(1, 2)"],
      ["constraint", "CHECK(LENGTH(A) < 10)"],
      ["constraint", "UNIQUE(A, ID)"],
    ]);
    expect(parts.clauses[1]?.source).toBe("a TEXT DEFAULT (1, 2)");
    expect(parts.options).toBe("STRICT");
  });

  it("reads a quoted keyword as a column name, not a constraint", () => {
    const parts = splitCreateTableBody('CREATE TABLE t (id INTEGER PRIMARY KEY, "unique" TEXT, "check" INTEGER, UNIQUE ("check"))');
    expect(parts.clauses.map((clause) => clause.kind)).toEqual(["column", "column", "column", "constraint"]);
  });

  it("does not take a paren inside the table's quoted name as the body", () => {
    const parts = splitCreateTableBody('CREATE TABLE "a(b)" (x INT)');
    expect(parts.clauses.map((clause) => clause.normalized)).toEqual(["X INT"]);
  });

  it("refuses a table with no column list", () => {
    expect(() => splitCreateTableBody("CREATE TABLE t AS SELECT 1")).toThrow("no column list");
    expect(() => splitCreateTableBody("CREATE TABLE t AS SELECT 1")).toThrow(CliError);
  });
});

describe("declaredObjectNames()", () => {
  it("reads every CREATE, through IF NOT EXISTS, modifiers and a schema qualifier", () => {
    const sql = `CREATE TABLE IF NOT EXISTS a (x INT); CREATE UNIQUE INDEX i ON a (x); create trigger "t r" after insert on a begin select 1; end; CREATE VIEW main.v AS SELECT 1; -- CREATE TABLE no`;
    expect(declaredObjectNames(sql)).toEqual([
      { type: "table", name: "a" },
      { type: "index", name: "i" },
      { type: "trigger", name: "t r" },
      { type: "view", name: "v" },
    ]);
  });
});
