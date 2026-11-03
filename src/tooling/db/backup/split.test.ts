import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { cutSqlStatements, splitDumpStatements, sqlStatementSpans } from "./split";

describe("splitDumpStatements()", () => {
  it("cuts a dump at each semicolon, keeping a multi-line table whole", () => {
    expect(splitDumpStatements('PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE "t" (\n  a TEXT\n);\nINSERT INTO "t" ("a") VALUES(1);')).toEqual([
      "PRAGMA defer_foreign_keys=TRUE;",
      'CREATE TABLE "t" (\n  a TEXT\n);',
      'INSERT INTO "t" ("a") VALUES(1);',
    ]);
  });

  it("ignores a semicolon inside a string, a doubled quote, an identifier, a bracket or a comment", () => {
    const sql = [
      "INSERT INTO \"t\" (\"a\") VALUES('a;b''c;d');",
      'INSERT INTO "we;ird" ("a") VALUES(1);',
      "SELECT [x;y];",
      "-- a; comment\nSELECT 1;",
      "/* a; block */ SELECT 2;",
    ].join("\n");
    expect(splitDumpStatements(sql)).toEqual([
      "INSERT INTO \"t\" (\"a\") VALUES('a;b''c;d');",
      'INSERT INTO "we;ird" ("a") VALUES(1);',
      "SELECT [x;y];",
      "-- a; comment\nSELECT 1;",
      "/* a; block */ SELECT 2;",
    ]);
  });

  it("keeps a trigger's body whole up to its END", () => {
    const trigger = "CREATE TRIGGER t_ai AFTER INSERT ON t BEGIN\n  INSERT INTO log VALUES (1);\n  DELETE FROM log;\nEND;";
    expect(splitDumpStatements(`${trigger}\nCREATE VIEW v AS SELECT 1;`)).toEqual([trigger, "CREATE VIEW v AS SELECT 1;"]);
  });

  it("keeps a trigger whole past the END that closes a CASE inside its body, and every piece executes", () => {
    const trigger = "CREATE TRIGGER t_b AFTER INSERT ON t BEGIN UPDATE t SET b = CASE WHEN new.a > 0 THEN 'pos' ELSE 'neg' END; END;";
    const dump = `CREATE TABLE t (a INTEGER, b TEXT);\n${trigger}\nINSERT INTO "t" ("a","b") VALUES(1,NULL);`;
    const statements = splitDumpStatements(dump);
    expect(statements).toEqual(["CREATE TABLE t (a INTEGER, b TEXT);", trigger, 'INSERT INTO "t" ("a","b") VALUES(1,NULL);']);
    const db = new Database(":memory:");
    for (const statement of statements) db.exec(statement);
    expect(db.query("SELECT b FROM t").all()).toEqual([{ b: "pos" }]);
  });

  it("ends a statement that only names BEGIN or END as an identifier or in text, outside a trigger", () => {
    expect(splitDumpStatements('INSERT INTO "t" ("a") VALUES(\'CASE BEGIN\');\nSELECT 1 AS "end";')).toEqual([
      'INSERT INTO "t" ("a") VALUES(\'CASE BEGIN\');',
      'SELECT 1 AS "end";',
    ]);
  });

  it("keeps a last statement with no semicolon, and drops empty ones", () => {
    expect(splitDumpStatements(";;\nSELECT 1;\n\nSELECT 2")).toEqual(["SELECT 1;", "SELECT 2"]);
  });
});

describe("sqlStatementSpans()", () => {
  it("answers each fragment's offsets, ending at its semicolon, and the unterminated tail up to the text's length", () => {
    expect(sqlStatementSpans("SELECT 1;\nSELECT 2")).toEqual([
      { start: 0, end: 8, terminated: true, useful: true },
      { start: 9, end: 18, terminated: false, useful: true },
    ]);
  });

  it("returns an empty tail and a blank fragment, so each caller picks its own filter", () => {
    expect(sqlStatementSpans("SELECT 1;  ;")).toEqual([
      { start: 0, end: 8, terminated: true, useful: true },
      { start: 9, end: 11, terminated: true, useful: false },
      { start: 12, end: 12, terminated: false, useful: false },
    ]);
  });

  it("marks a fragment holding only comments as not useful, and one holding a literal as useful", () => {
    const sql = "-- a note\n/* and; another */;\n'x';";
    expect(sqlStatementSpans(sql).map(({ terminated, useful }) => ({ terminated, useful }))).toEqual([
      { terminated: true, useful: false },
      { terminated: true, useful: true },
      { terminated: false, useful: false },
    ]);
  });

  it("keeps a trigger whole past a CASE … END inside its body, a comment before CREATE included", () => {
    const trigger = "-- audit\nCREATE TEMP TRIGGER t_b AFTER INSERT ON t BEGIN UPDATE t SET b = CASE WHEN new.a > 0 THEN 1 END; END";
    const sql = `${trigger};\nSELECT 1;`;
    expect(sqlStatementSpans(sql).map(({ start, end }) => sql.slice(start, end))).toEqual([trigger, "\nSELECT 1", ""]);
  });
});

describe("cutSqlStatements()", () => {
  it("answers each statement trimmed and without its semicolon, dropping blank and comment-only fragments", () => {
    expect(cutSqlStatements("-- head\n;\nINSERT INTO t VALUES ('a;b');  ;\n/* tail */")).toEqual(["INSERT INTO t VALUES ('a;b')"]);
  });

  it("keeps a comment that leads a statement, as the statement's own text", () => {
    expect(cutSqlStatements("-- seeds\nINSERT INTO t VALUES (1);\nSELECT 2")).toEqual(["-- seeds\nINSERT INTO t VALUES (1)", "SELECT 2"]);
  });

  it("passes a literal holding BEGIN TRANSACTION and COMMIT through byte for byte", () => {
    const insert = "INSERT INTO notes (body) VALUES ('BEGIN TRANSACTION; step; COMMIT;')";
    expect(cutSqlStatements(`${insert};\n${insert};`)).toEqual([insert, insert]);
  });

  it("answers a statement already cut, which a local load re-cuts, unchanged", () => {
    const statement = "CREATE TRIGGER t_ai AFTER INSERT ON t BEGIN INSERT INTO log VALUES (1); END";
    expect(cutSqlStatements(statement)).toEqual([statement]);
    expect(cutSqlStatements(`${statement};`)).toEqual([statement]);
  });
});
