import { describe, expect, it } from "bun:test";

import { fakeDbIo } from "../db.fixture";
import { sha256 } from "../digest";
import { INVENTORY_SELECT, quoteSqlIdentifier, quoteSqlLiteral, rowCountSelect, tableInfoSelect } from "../sql";
import type { BackupManifest, DbIo, SchemaFacts, SchemaObject } from "../types";
import {
  appSchemaDigestInput,
  BACKUP_FORMAT_VERSION,
  canonicaliseRow,
  canonicaliseValue,
  checkDataArtifact,
  checkInventory,
  checkRestoreTarget,
  checkSchemaArtifact,
  classifyTable,
  compareKeys,
  compareManifests,
  compareSchemaObjects,
  compareTableInfo,
  digestInput,
  findVirtualTables,
  formatBackupDirectory,
  insertStatement,
  isVerifiedBackupOf,
  manifestSelfDigest,
  schemaDigestInput,
  SqlReal,
  sqlValueExpression,
  UnsupportedValue,
  validateManifest,
  decodeReadRow,
  verificationSelect,
  verifyBackupArtifact,
} from "./artifact";
import type { AppTable } from "./types";

function capture(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

const NUL = String.fromCharCode(0);
const BACKSLASH_N = `${String.fromCharCode(92)}n`;

const APP_TABLES = ["projects", "epics", "tasks"];

function appObject(name: string, sql = `CREATE TABLE ${name} (uuid TEXT PRIMARY KEY)`): SchemaObject {
  return { type: "table", name, tblName: name, sql };
}

const AN_INDEX: SchemaObject = {
  type: "index",
  name: "idx_tasks_lane_priority",
  tblName: "tasks",
  sql: "CREATE INDEX idx_tasks_lane_priority ON tasks (lane, priority)",
};

function healthyInventory(): SchemaObject[] {
  return [...APP_TABLES.map((name) => appObject(name)), AN_INDEX];
}

describe("classifyTable()", () => {
  it("classifies the engine's and Cloudflare's own objects as system", () => {
    expect(["sqlite_autoindex_tasks_1", "_cf_METADATA", "sqlite_stat1"].map((name) => classifyTable(name))).toEqual(["system", "system", "system"]);
  });

  it("classifies the sequence and forge's own companions as managed", () => {
    expect(["sqlite_sequence", "_forge_migrations", "_forge_seed_history"].map((name) => classifyTable(name))).toEqual([
      "managed",
      "managed",
      "managed",
    ]);
  });

  it("classifies anything else as the app's, including wrangler's own migrations table and a bare forge_ name", () => {
    expect(["tasks", "some_table_nobody_declared", "d1_migrations", "forge_migrations"].map((name) => classifyTable(name))).toEqual([
      "app",
      "app",
      "app",
      "app",
    ]);
  });
});

describe("findVirtualTables()", () => {
  it("names a virtual table by its declaration, whatever its name suggests", () => {
    const objects: SchemaObject[] = [
      appObject("tasks"),
      { type: "table", name: "tasks_fts", tblName: "tasks_fts", sql: "CREATE VIRTUAL TABLE tasks_fts USING fts5(summary, details)" },
    ];

    expect(findVirtualTables(objects)).toEqual(["tasks_fts"]);
  });

  it("matches a lowercase declaration with leading whitespace, since neither is a defence", () => {
    expect(findVirtualTables([{ type: "table", name: "n", tblName: "n", sql: "  create virtual table n using fts5(body)" }])).toEqual(["n"]);
  });

  it("finds nothing in an ordinary schema, and tolerates a null sql", () => {
    expect(findVirtualTables([...healthyInventory(), { type: "table", name: "x", tblName: "x", sql: null }])).toEqual([]);
  });
});

describe("checkInventory()", () => {
  it("passes an ordinary schema", () => {
    expect(checkInventory(healthyInventory())).toEqual([]);
  });

  it("names a virtual table before wrangler is ever invoked", () => {
    const objects = [
      ...healthyInventory(),
      { type: "table", name: "tasks_fts", tblName: "tasks_fts", sql: "CREATE VIRTUAL TABLE tasks_fts USING fts5(summary)" },
    ];

    expect(checkInventory(objects)).toEqual([
      "tasks_fts is a virtual table — wrangler's dump generator throws on CREATE VIRTUAL TABLE, so this database cannot be exported or restored",
    ]);
  });

  it("refuses AUTOINCREMENT on an app table, and names which table declared it", () => {
    const objects = healthyInventory().map((object) =>
      object.name === "tasks" ? appObject("tasks", "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT)") : object,
    );

    expect(checkInventory(objects)).toEqual([
      "AUTOINCREMENT is declared on app table(s) [tasks] and no app table may be — a backup restores keys from the artifact, and an engine-allocated one needs sqlite_sequence carried alongside it",
    ]);
  });

  it("names every app table that declared it, sorted, in one message", () => {
    const objects = healthyInventory().map((object) =>
      object.name === "tasks" || object.name === "epics"
        ? appObject(object.name, `CREATE TABLE ${object.name} (id INTEGER PRIMARY KEY AUTOINCREMENT)`)
        : object,
    );

    expect(checkInventory(objects)).toEqual([
      "AUTOINCREMENT is declared on app table(s) [epics, tasks] and no app table may be — a backup restores keys from the artifact, and an engine-allocated one needs sqlite_sequence carried alongside it",
    ]);
  });

  it("refuses a lowercase declaration, since letter case is not a defence", () => {
    const objects = [appObject("projects", "create table projects (id integer primary key autoincrement)")];

    expect(checkInventory(objects)).toEqual([
      "AUTOINCREMENT is declared on app table(s) [projects] and no app table may be — a backup restores keys from the artifact, and an engine-allocated one needs sqlite_sequence carried alongside it",
    ]);
  });

  it("ignores managed and system tables, including forge's own migrations table's AUTOINCREMENT", () => {
    const objects = [
      ...healthyInventory(),
      { type: "table", name: "sqlite_sequence", tblName: "sqlite_sequence", sql: "CREATE TABLE sqlite_sequence(name,seq)" },
      {
        type: "table",
        name: "_forge_migrations",
        tblName: "_forge_migrations",
        sql: "CREATE TABLE _forge_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT)",
      },
    ];

    expect(checkInventory(objects)).toEqual([]);
  });
});

describe("compareSchemaObjects()", () => {
  it("finds nothing between two identical schemas", () => {
    expect(compareSchemaObjects(healthyInventory(), healthyInventory())).toEqual([]);
  });

  it("reports an object only the source declares", () => {
    expect(compareSchemaObjects([appObject("tasks"), AN_INDEX], [appObject("tasks")])).toEqual([
      "index idx_tasks_lane_priority is in the source and not in the target",
    ]);
  });

  it("reports an object only the target declares", () => {
    expect(compareSchemaObjects([appObject("tasks")], [appObject("tasks"), AN_INDEX])).toEqual([
      "index idx_tasks_lane_priority is in the target and not in the source",
    ]);
  });

  it("reports a declaration that differs, which is the only way schema drift without a migration surfaces", () => {
    const target = [appObject("tasks", "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, extra TEXT)")];

    expect(compareSchemaObjects([appObject("tasks")], target)).toEqual(["table tasks: the declaration differs between source and target"]);
  });

  it("reports an index reattached to a different table", () => {
    expect(compareSchemaObjects([AN_INDEX], [{ ...AN_INDEX, tblName: "epics" }])).toEqual([
      "index idx_tasks_lane_priority: tbl_name is tasks in the source and epics in the target",
    ]);
  });

  it("treats a null declaration and an empty one as the same, since neither is a declaration", () => {
    const source: SchemaObject[] = [{ type: "table", name: "t", tblName: "t", sql: null }];
    const target: SchemaObject[] = [{ type: "table", name: "t", tblName: "t", sql: "" }];

    expect(compareSchemaObjects(source, target)).toEqual([]);
  });
});

const TASKS_COLUMNS = [
  { cid: 0, name: "uuid", type: "TEXT", notnull: 0, dfltValue: null, pk: 1 },
  { cid: 1, name: "resolution", type: "TEXT", notnull: 1, dfltValue: "''", pk: 0 },
];

describe("compareTableInfo()", () => {
  it("finds nothing between two identical column lists", () => {
    expect(compareTableInfo("tasks", TASKS_COLUMNS, TASKS_COLUMNS)).toEqual([]);
  });

  it("reports a differing column count and judges no position it cannot", () => {
    expect(compareTableInfo("tasks", TASKS_COLUMNS, TASKS_COLUMNS.slice(0, 1))).toEqual(["tasks: 2 columns in the source and 1 in the target"]);
  });

  it("names every attribute of one column that moved, in one message", () => {
    const target = [TASKS_COLUMNS[0]!, { cid: 1, name: "resolutions", type: "TEXT", notnull: 0, dfltValue: null, pk: 0 }];

    expect(compareTableInfo("tasks", TASKS_COLUMNS, target)).toEqual(["tasks column 1: name resolution/resolutions, notnull 1/0, default ''/NULL"]);
  });

  it("reports two columns swapped, which is the position check nothing else performs", () => {
    expect(compareTableInfo("tasks", TASKS_COLUMNS, [TASKS_COLUMNS[1]!, TASKS_COLUMNS[0]!])).toEqual([
      "tasks column 0: cid 0/1, name uuid/resolution, notnull 0/1, default NULL/'', pk 1/0",
      "tasks column 1: cid 1/0, name resolution/uuid, notnull 1/0, default ''/NULL, pk 0/1",
    ]);
  });
});

describe("canonicaliseValue()", () => {
  it('keeps INTEGER 0 and TEXT "0" apart, because affinity can turn one into the other', () => {
    expect(canonicaliseValue("ordinal", 0)).toBe("I:0");
    expect(canonicaliseValue("ordinal", "0")).toBe("S:1:0");
  });

  it("keeps NULL and the empty string apart, since a present-and-empty column is never NULL", () => {
    expect(canonicaliseValue("resolution", null)).toBe("N");
    expect(canonicaliseValue("resolution", "")).toBe("S:0:");
  });

  it("encodes text with its length, an integer, and a real under a tag of its own", () => {
    expect(canonicaliseValue("summary", "todo")).toBe("S:4:todo");
    expect(canonicaliseValue("seq", -1)).toBe("I:-1");
    expect(canonicaliseValue("seq", Number.MAX_SAFE_INTEGER)).toBe("I:9007199254740991");
    expect(canonicaliseValue("weight", 1.5)).toBe("R:1.5");
  });

  it("keeps a REAL that is integral apart from the INTEGER --json would make of it", () => {
    expect(canonicaliseValue("weight", new SqlReal(1))).toBe("R:1");
    expect(canonicaliseValue("weight", new SqlReal(1))).not.toBe(canonicaliseValue("weight", 1));
    expect(canonicaliseValue("weight", new SqlReal(2.5))).toBe("R:2.5");
  });

  it("encodes a BLOB as lowercase hex, which is the array of byte values --json returns", () => {
    expect(canonicaliseValue("id", [1, 2, 3])).toBe("B:010203");
    expect(canonicaliseValue("id", [0, 255, 16])).toBe("B:00ff10");
    expect(canonicaliseValue("id", [])).toBe("B:");
  });

  it("encodes a Uint8Array exactly as it encodes the array of byte values", () => {
    expect(canonicaliseValue("id", new Uint8Array([1, 2, 3]))).toBe("B:010203");
  });

  it("keeps a BLOB and the text of its hex apart, since one is not the other to SQLite", () => {
    expect(canonicaliseValue("id", [171, 205])).toBe("B:abcd");
    expect(canonicaliseValue("id", "abcd")).toBe("S:4:abcd");
  });

  it("refuses an array that is not all byte values, naming the column so the message points at the schema", () => {
    const error = capture(() => canonicaliseValue("payload", [1, "a"])) as UnsupportedValue;

    expect(error.name).toBe("UnsupportedValue");
    expect(error.column).toBe("payload");
    expect(error.message).toBe(
      "payload: a object cannot be encoded — a BLOB reads back from --json as an array of byte values, and this is not one",
    );
  });

  it("refuses an array holding a number outside a byte, and a plain object", () => {
    expect((capture(() => canonicaliseValue("payload", [256])) as UnsupportedValue).message).toBe(
      "payload: a object cannot be encoded — a BLOB reads back from --json as an array of byte values, and this is not one",
    );
    expect((capture(() => canonicaliseValue("payload", { length: 1 })) as UnsupportedValue).message).toBe(
      "payload: a object cannot be encoded — a BLOB reads back from --json as an array of byte values, and this is not one",
    );
  });

  it("refuses an integer past 2^53, which JSON.parse has already rounded", () => {
    expect((capture(() => canonicaliseValue("seq", Number.MAX_SAFE_INTEGER + 2)) as UnsupportedValue).message).toBe(
      "seq: the integer 9007199254740992 is past 2^53 and has already lost precision in JSON",
    );
  });

  it("refuses a boolean, an undefined, a NaN and an Infinity", () => {
    expect((capture(() => canonicaliseValue("lane", true)) as UnsupportedValue).message).toBe(
      "lane: SQLite has no boolean type — a boolean here means the row was not read from D1",
    );
    expect((capture(() => canonicaliseValue("closed_at", undefined)) as UnsupportedValue).message).toBe(
      "closed_at: undefined is not a SQLite value — a NULL column reads back as null",
    );
    expect((capture(() => canonicaliseValue("weight", Number.NaN)) as UnsupportedValue).message).toBe("weight: NaN is not a finite number");
    expect((capture(() => canonicaliseValue("weight", Number.POSITIVE_INFINITY)) as UnsupportedValue).message).toBe(
      "weight: Infinity is not a finite number",
    );
  });
});

describe("canonicaliseRow()", () => {
  it("encodes the key, the whole row and each cell by column name", () => {
    expect(canonicaliseRow(["seq", "lane"], "seq", { seq: 124, lane: "todo" })).toEqual({
      key: "I:124",
      canonical: "I:124 S:4:todo",
      cells: { seq: "I:124", lane: "S:4:todo" },
    });
  });

  it("gives two rows whose cells differ only in where the separator falls different canonical strings", () => {
    const left = canonicaliseRow(["a", "b"], "a", { a: "a:b", b: "c" });
    const right = canonicaliseRow(["a", "b"], "a", { a: "a", b: "b:c" });

    expect(left.canonical).toBe("S:3:a:b S:1:c");
    expect(right.canonical).toBe("S:1:a S:3:b:c");
  });

  it("encodes cells in the order columns are given", () => {
    expect(canonicaliseRow(["lane", "seq"], "seq", { seq: 124, lane: "todo" }).canonical).toBe("S:4:todo I:124");
  });

  it("throws when a column is absent from the row rather than encoding it as NULL", () => {
    const error = capture(() => canonicaliseRow(["seq", "lane"], "seq", { seq: 124 })) as UnsupportedValue;

    expect(error.column).toBe("lane");
    expect(error.message).toBe("lane: the column is absent from the row — the read did not return it");
  });

  it("encodes a column present and explicitly null, which is not the same as absent", () => {
    expect(canonicaliseRow(["seq", "lane"], "seq", { seq: 124, lane: null }).cells).toEqual({ seq: "I:124", lane: "N" });
  });

  it("throws when the key column is not among the columns read", () => {
    expect((capture(() => canonicaliseRow(["lane"], "seq", { lane: "todo" })) as UnsupportedValue).message).toBe(
      "seq: the key column is not among the columns read",
    );
  });
});

describe("digestInput() and schemaDigestInput()", () => {
  it("joins canonical rows one per line, and is empty for a table with no rows", () => {
    expect(digestInput(["I:1 S:4:todo", "I:2 S:5:doing"])).toBe("I:1 S:4:todo\nI:2 S:5:doing");
    expect(digestInput([])).toBe("");
  });

  it("canonicalises a schema by type then name, so declaration order cannot change the digest", () => {
    const objects: SchemaObject[] = [
      { type: "table", name: "tasks", tblName: "tasks", sql: "CREATE TABLE tasks (uuid TEXT)" },
      AN_INDEX,
      { type: "table", name: "epics", tblName: "epics", sql: null },
    ];

    expect(schemaDigestInput(objects)).toBe(
      [
        'index\tidx_tasks_lane_priority\ttasks\t"CREATE INDEX idx_tasks_lane_priority ON tasks (lane, priority)"',
        "table\tepics\tepics\tnull",
        'table\ttasks\ttasks\t"CREATE TABLE tasks (uuid TEXT)"',
      ].join("\n"),
    );
  });

  it("does not mutate the array it was given", () => {
    const objects = [appObject("tasks"), appObject("epics")];
    schemaDigestInput(objects);

    expect(objects.map((object) => object.name)).toEqual(["tasks", "epics"]);
  });
});

describe("compareKeys()", () => {
  it("orders I:9 before I:10 numerically, which is what ORDER BY produced", () => {
    expect(compareKeys("I:9", "I:10")).toBe(-1);
    expect(compareKeys("I:10", "I:9")).toBe(1);
  });

  it("orders a text key lexicographically, where 9 follows 10", () => {
    expect(compareKeys("S:1:9", "S:2:10")).toBe(1);
  });

  it("ranks NULL before a number before text, which is SQLite's own order", () => {
    expect(compareKeys("N", "I:0")).toBe(-1);
    expect(compareKeys("I:0", "S:1:a")).toBe(-1);
    expect(compareKeys("S:1:a", "N")).toBe(1);
  });

  it("reports equality for two identical keys of each type", () => {
    expect([compareKeys("N", "N"), compareKeys("I:7", "I:7"), compareKeys("S:3:abc", "S:3:abc")]).toEqual([0, 0, 0]);
  });

  it("compares text after the length prefix, so a longer key is not ordered by its own digits", () => {
    expect(compareKeys("S:10:aaaaaaaaaa", "S:2:ab")).toBe(-1);
  });

  it("orders a real alongside an integer, since both are numbers to SQLite", () => {
    expect(compareKeys("I:1", "R:1.5")).toBe(-1);
    expect(compareKeys("R:1.5", "I:2")).toBe(-1);
  });

  it("orders an astral character after every BMP one, as BINARY does and JS `<` does not", () => {
    expect(compareKeys("S:1:�", "S:2:\u{1F600}")).toBe(-1);
    // oxlint-disable-next-line eslint/no-constant-binary-expression -- comparing two literals is the assertion
    expect("�" < "\u{1F600}").toBe(false);
  });

  it("orders a prefix before the string that extends it", () => {
    expect(compareKeys("S:3:abc", "S:4:abcd")).toBe(-1);
  });

  it("ranks a BLOB after text, which is where BINARY puts it", () => {
    expect(compareKeys("S:1:z", "B:00ff")).toBe(-1);
    expect(compareKeys("B:00ff", "S:1:z")).toBe(1);
    expect(compareKeys("N", "B:00")).toBe(-1);
    expect(compareKeys("I:9007199254740991", "B:00")).toBe(-1);
  });

  it("compares two blobs bytewise, a shorter one before the blob that extends it", () => {
    expect(compareKeys("B:00", "B:0000")).toBe(-1);
    expect(compareKeys("B:0000", "B:00")).toBe(1);
    expect(compareKeys("B:00ff", "B:0100")).toBe(-1);
    expect(compareKeys("B:010203", "B:010203")).toBe(0);
  });
});

describe("quoteSqlLiteral()", () => {
  it("doubles every single quote, which is the whole of SQLite's escaping", () => {
    expect(quoteSqlLiteral("a'b")).toBe("'a''b'");
    expect(quoteSqlLiteral("''")).toBe("''''''");
    expect(quoteSqlLiteral("")).toBe("''");
  });

  it("passes a newline and a backslash through, because SQLite has no backslash escape", () => {
    expect(quoteSqlLiteral("a\nb")).toBe("'a\nb'");
    expect(quoteSqlLiteral("a\\b")).toBe("'a\\b'");
    expect(quoteSqlLiteral("a\\'b")).toBe("'a\\''b'");
  });

  it("renders a bare integer with no quotes at all", () => {
    expect([quoteSqlLiteral(124), quoteSqlLiteral(0), quoteSqlLiteral(-1)]).toEqual(["124", "0", "-1"]);
  });

  it("refuses a NUL byte, which would truncate the statement rather than escape", () => {
    expect((capture(() => quoteSqlLiteral(`a${NUL}b`)) as Error).message).toBe("a NUL byte cannot appear in a SQL string literal");
  });

  it("refuses NaN, Infinity and an integer past 2^53", () => {
    expect((capture(() => quoteSqlLiteral(Number.NaN)) as Error).message).toBe("NaN is not a finite number and has no SQL literal");
    expect((capture(() => quoteSqlLiteral(Number.POSITIVE_INFINITY)) as Error).message).toBe(
      "Infinity is not a finite number and has no SQL literal",
    );
    expect((capture(() => quoteSqlLiteral(Number.MAX_SAFE_INTEGER + 2)) as Error).message).toBe(
      "the integer 9007199254740992 is past 2^53 and cannot round-trip as a literal",
    );
  });
});

describe("quoteSqlIdentifier()", () => {
  it("wraps a name in double quotes, doubling an embedded one", () => {
    expect(quoteSqlIdentifier("counted_rows")).toBe('"counted_rows"');
    expect(quoteSqlIdentifier('we"ird')).toBe('"we""ird"');
    expect(quoteSqlIdentifier("order")).toBe('"order"');
  });

  it("refuses a NUL byte", () => {
    expect((capture(() => quoteSqlIdentifier(`a${NUL}b`)) as Error).message).toBe("a NUL byte cannot appear in a SQL identifier");
  });
});

const REPLACE_CALL = /^replace\((.+),'(~~[NR]\d*~~)',char\((10|13)\)\)$/;

/** SQLite's own reading of what `sqlValueExpression` emits, applied innermost-first as the engine would. */
function evaluateSqlText(expression: string): string {
  const call = REPLACE_CALL.exec(expression);
  if (call !== null) return evaluateSqlText(call[1]!).replaceAll(call[2]!, call[3] === "10" ? "\n" : "\r");
  if (!expression.startsWith("'") || !expression.endsWith("'")) throw new Error(`not a SQL string literal: ${expression}`);
  return expression.slice(1, -1).replaceAll("''", "'");
}

const ROUND_TRIPS: readonly { readonly why: string; readonly value: string }[] = [
  { why: "plain text with newlines", value: "## Resolution\nthe claim raced and lost\n" },
  { why: "text already holding the first token the encoder would pick", value: "a ~~N~~ token\nand a newline" },
  { why: "text already holding both tokens and both line endings", value: "~~N~~ and ~~R~~\nboth\r\nverbatim" },
  { why: "text holding the two characters backslash-n, which is what wrangler rewrites", value: `a${BACKSLASH_N}b\nc` },
  { why: "text holding single quotes, which are the literal's own escape", value: "it's 'quoted'\nand it's still quoted" },
  { why: "text holding a token, a backslash-n, quotes and both line endings at once", value: `~~N~~ '${BACKSLASH_N}' ~~R~~\r\n~~N1~~ 'x'\n\r end` },
];

describe("sqlValueExpression() — the wrangler corruption this replaces", () => {
  it("leaves a backslash verbatim inside the literal, so backslash-n is never an escape", () => {
    expect(sqlValueExpression("details", `C:${BACKSLASH_N}otes`)).toBe(`'C:${BACKSLASH_N}otes'`);
  });

  it("carries a real newline and a literal backslash-n in one value without either becoming the other", () => {
    const value = `a${BACKSLASH_N}b\nc`;

    expect(sqlValueExpression("details", value)).toBe(`replace('a${BACKSLASH_N}b~~N~~c','~~N~~',char(10))`);
    expect(evaluateSqlText(sqlValueExpression("details", value))).toBe(value);
  });

  it("keeps a backslash-n value and the newline it would be mistaken for as different expressions", () => {
    expect(sqlValueExpression("details", BACKSLASH_N) === sqlValueExpression("details", "\n")).toBe(false);
  });
});

describe("sqlValueExpression() — the plain values", () => {
  it("returns exactly the quoted literal for a value with no line ending", () => {
    expect(sqlValueExpression("summary", "claim the next task")).toBe(quoteSqlLiteral("claim the next task"));
    expect(sqlValueExpression("summary", "it's quoted")).toBe(quoteSqlLiteral("it's quoted"));
  });

  it("writes NULL for null, which an empty string must not collide with", () => {
    expect(sqlValueExpression("resolution", null)).toBe("NULL");
    expect(sqlValueExpression("resolution", "")).toBe("''");
  });

  it("writes a byte array as a blob literal, and an empty one as the empty blob", () => {
    expect(sqlValueExpression("id", [1, 2, 3])).toBe("X'010203'");
    expect(sqlValueExpression("id", [0, 255, 16])).toBe("X'00ff10'");
    expect(sqlValueExpression("id", [])).toBe("X''");
    expect(sqlValueExpression("id", new Uint8Array([171, 205]))).toBe("X'abcd'");
  });

  it("writes an integral REAL with its point, so a column with no affinity keeps the storage class", () => {
    expect(sqlValueExpression("weight", new SqlReal(1))).toBe("1.0");
    expect(sqlValueExpression("weight", new SqlReal(-3))).toBe("-3.0");
    expect(sqlValueExpression("weight", new SqlReal(2.5))).toBe("2.5");
    expect(sqlValueExpression("weight", new SqlReal(1e21))).toBe("1e+21");
  });

  it("writes a number unquoted and TEXT quoted, so affinity lands each in the column as it was read", () => {
    expect([sqlValueExpression("seq", 124), sqlValueExpression("ordinal", 0), sqlValueExpression("seq", -1)]).toEqual(["124", "0", "-1"]);
    expect(sqlValueExpression("weight", 1.5)).toBe("1.5");
    expect(sqlValueExpression("ordinal", "0")).toBe("'0'");
  });
});

describe("sqlValueExpression() — the newline encoding", () => {
  it("wraps a newline and a carriage return in the replace() the restore undoes, pinned to the byte", () => {
    expect(sqlValueExpression("details", "a\nb")).toBe("replace('a~~N~~b','~~N~~',char(10))");
    expect(sqlValueExpression("details", "a\rb")).toBe("replace('a~~R~~b','~~R~~',char(13))");
  });

  it("emits both wrappers for a CRLF, char(10) inside char(13)", () => {
    expect(sqlValueExpression("details", "a\r\nb")).toBe("replace(replace('a~~R~~~~N~~b','~~N~~',char(10)),'~~R~~',char(13))");
  });

  it("escalates past every candidate the value contains, not merely the first", () => {
    expect(sqlValueExpression("details", "a~~N~~b\nc")).toBe("replace('a~~N~~b~~N1~~c','~~N1~~',char(10))");
    expect(sqlValueExpression("details", "x~~N~~x~~N1~~x\ny")).toBe("replace('x~~N~~x~~N1~~x~~N2~~y','~~N2~~',char(10))");
  });

  for (const { why, value } of ROUND_TRIPS) {
    it(`round-trips through SQLite's own decode: ${why}`, () => {
      expect(evaluateSqlText(sqlValueExpression("details", value))).toBe(value);
    });
  }

  it("refuses a value that occupies every candidate token rather than corrupting it", () => {
    const tokens = Array.from({ length: 64 }, (_, index) => `x~~N${index === 0 ? "" : index}~~`).join("");
    const error = capture(() => sqlValueExpression("details", `${tokens}\n`)) as UnsupportedValue;

    expect(error.column).toBe("details");
    expect(error.message).toBe("details: no newline token survives a round trip against this value — every candidate occurs in the data");
  });
});

describe("sqlValueExpression() — what it refuses", () => {
  it("refuses a boolean, a value no BLOB could be and an undefined, naming the column", () => {
    expect((capture(() => sqlValueExpression("lane", true)) as UnsupportedValue).message).toBe(
      "lane: a boolean cannot be written to an artifact — a BLOB reads back from --json as an array of byte values, and this is not one",
    );
    expect((capture(() => sqlValueExpression("payload", [1, "a"])) as UnsupportedValue).message).toBe(
      "payload: a object cannot be written to an artifact — a BLOB reads back from --json as an array of byte values, and this is not one",
    );
    expect((capture(() => sqlValueExpression("payload", { length: 1 })) as UnsupportedValue).message).toBe(
      "payload: a object cannot be written to an artifact — a BLOB reads back from --json as an array of byte values, and this is not one",
    );
    expect((capture(() => sqlValueExpression("closed_at", undefined)) as UnsupportedValue).message).toBe(
      "closed_at: a undefined cannot be written to an artifact — a BLOB reads back from --json as an array of byte values, and this is not one",
    );
  });

  it("refuses an integer past 2^53, a NaN and an Infinity", () => {
    expect((capture(() => sqlValueExpression("seq", Number.MAX_SAFE_INTEGER + 2)) as UnsupportedValue).message).toBe(
      "seq: the integer 9007199254740992 is past 2^53 and cannot round-trip",
    );
    expect((capture(() => sqlValueExpression("weight", Number.NaN)) as UnsupportedValue).message).toBe("weight: NaN has no SQL literal");
    expect((capture(() => sqlValueExpression("weight", Number.POSITIVE_INFINITY)) as UnsupportedValue).message).toBe(
      "weight: Infinity has no SQL literal",
    );
  });

  it("refuses a NUL byte on the plain path and on the token path", () => {
    expect((capture(() => sqlValueExpression("details", `a${NUL}b`)) as Error).message).toBe(
      "details: a NUL byte cannot appear in a SQL string literal",
    );
    expect((capture(() => sqlValueExpression("details", `a${NUL}b\nc`)) as Error).message).toBe(
      "details: a NUL byte cannot appear in a SQL string literal",
    );
  });
});

describe("insertStatement()", () => {
  it("emits one row as an INSERT naming its columns, pinned to the byte", () => {
    expect(insertStatement("tasks", ["uuid", "lane"], { uuid: "t", lane: "todo" })).toBe(
      `INSERT INTO "tasks" ("uuid","lane") VALUES ('t','todo');`,
    );
  });

  it("writes an integral REAL as 1.0, never as the 1 --json handed over", () => {
    expect(insertStatement("scores", ["id", "weight"], { id: 1, weight: new SqlReal(1) })).toBe(
      `INSERT INTO "scores" ("id","weight") VALUES (1,1.0);`,
    );
  });

  it("refuses a NUL byte in a value as an UnsupportedValue naming the column", () => {
    const thrown = capture(() => insertStatement("tasks", ["uuid", "lane"], { uuid: "t", lane: "to\0do" }));
    expect(thrown).toBeInstanceOf(UnsupportedValue);
    expect((thrown as UnsupportedValue).column).toBe("lane");
    expect((thrown as Error).message).toBe("lane: a NUL byte cannot appear in a SQL string literal");
    expect(capture(() => insertStatement("tasks", ["uuid"], { uuid: "a\nb\0c" }))).toBeInstanceOf(UnsupportedValue);
  });

  it("writes a null, an integer and a quoted string in one statement", () => {
    expect(insertStatement("events", ["seq", "actor", "summary"], { seq: 124, actor: null, summary: "it's done" })).toBe(
      `INSERT INTO "events" ("seq","actor","summary") VALUES (124,NULL,'it''s done');`,
    );
  });

  it("names the columns in the order given, so the artifact does not depend on declaration order", () => {
    const row = { uuid: "e", body: "an epic body", project_uuid: "p" };

    expect(insertStatement("epics", ["uuid", "body", "project_uuid"], row)).toBe(
      `INSERT INTO "epics" ("uuid","body","project_uuid") VALUES ('e','an epic body','p');`,
    );
    expect(insertStatement("epics", ["project_uuid", "uuid", "body"], row)).toBe(
      `INSERT INTO "epics" ("project_uuid","uuid","body") VALUES ('p','e','an epic body');`,
    );
  });

  it("writes the idempotent form under orIgnore, and the bare one for an absent bag or a false flag", () => {
    const row = { uuid: "t", lane: "todo" };
    expect(insertStatement("tasks", ["uuid", "lane"], row, { orIgnore: true })).toBe(
      `INSERT OR IGNORE INTO "tasks" ("uuid","lane") VALUES ('t','todo');`,
    );
    expect(insertStatement("tasks", ["uuid", "lane"], row, { orIgnore: false })).toBe(`INSERT INTO "tasks" ("uuid","lane") VALUES ('t','todo');`);
    expect(insertStatement("tasks", ["uuid", "lane"], row, {})).toBe(`INSERT INTO "tasks" ("uuid","lane") VALUES ('t','todo');`);
  });

  it("quotes a table and column name unconditionally, so a keyword name still loads", () => {
    expect(insertStatement("order", ["key"], { key: "k" })).toBe(`INSERT INTO "order" ("key") VALUES ('k');`);
  });

  it("round-trips a row whose primary key is a 16-byte BLOB", () => {
    const id = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255];

    expect(insertStatement("auth_users", ["id", "email"], { id, email: "a@b.test" })).toBe(
      `INSERT INTO "auth_users" ("id","email") VALUES (X'00112233445566778899aabbccddeeff','a@b.test');`,
    );
    expect(canonicaliseRow(["id", "email"], "id", { id, email: "a@b.test" }).key).toBe("B:00112233445566778899aabbccddeeff");
  });

  it("throws when a column is absent from the row rather than silently writing NULL", () => {
    expect((capture(() => insertStatement("tasks", ["uuid", "lane"], { uuid: "t" })) as UnsupportedValue).message).toBe(
      "lane: the column is absent from the row — the read did not return it",
    );
  });

  it("emits a single line even for a row whose value holds newlines and carriage returns", () => {
    const statement = insertStatement("tasks", ["uuid", "details"], { uuid: "t", details: "first\nsecond\r\nthird\r" });

    expect(statement.includes("\n")).toBe(false);
    expect(statement.includes("\r")).toBe(false);
    expect(statement.startsWith(`INSERT INTO "tasks"`)).toBe(true);
  });

  it("round-trips every value it writes through SQLite's own decode", () => {
    for (const { value } of ROUND_TRIPS) {
      const statement = insertStatement("tasks", ["details"], { details: value });

      expect(evaluateSqlText(statement.slice(`INSERT INTO "tasks" ("details") VALUES (`.length, -2))).toBe(value);
    }
  });
});

describe("the fixed statements", () => {
  it("reads sqlite_master excluding the engine's and Cloudflare's own objects", () => {
    expect(INVENTORY_SELECT).toBe(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type, name",
    );
  });

  it("reads one table's columns in declaration order, escaping the name as a literal", () => {
    expect(tableInfoSelect("tasks")).toBe("SELECT cid, name, type, \"notnull\", dflt_value, pk FROM pragma_table_info('tasks') ORDER BY cid");
    expect(tableInfoSelect("a'b")).toBe("SELECT cid, name, type, \"notnull\", dflt_value, pk FROM pragma_table_info('a''b') ORDER BY cid");
  });

  it("counts a table's rows through a quoted identifier", () => {
    expect(rowCountSelect("counted_rows")).toBe('SELECT COUNT(*) AS rows FROM "counted_rows"');
  });
});

describe("verificationSelect()", () => {
  const UUID_KEYED: AppTable = { name: "tasks", key: "uuid", columns: ["uuid", "lane"], pageRows: 256 };
  const INTEGER_KEYED: AppTable = { name: "counted_rows", key: "seq", columns: ["seq"], pageRows: 512 };

  const projected = (column: string) =>
    `CASE WHEN typeof("${column}")='blob' THEN hex("${column}") ELSE "${column}" END AS "${column}", typeof("${column}") AS "forge:type:${column}"`;

  it("reads the first page with no seek, each column beside its storage class", () => {
    expect(verificationSelect(UUID_KEYED, ["uuid", "lane"], null)).toBe(
      `SELECT ${projected("uuid")}, ${projected("lane")} FROM "tasks" AS t ORDER BY t."uuid" LIMIT 256`,
    );
  });

  it("seeks past the last key read on a later page", () => {
    expect(verificationSelect(UUID_KEYED, ["uuid"], "0f6c1b2a")).toBe(
      `SELECT ${projected("uuid")} FROM "tasks" AS t WHERE t."uuid" > '0f6c1b2a' ORDER BY t."uuid" LIMIT 256`,
    );
  });

  it("seeks past an integer cursor without quoting it", () => {
    expect(verificationSelect(INTEGER_KEYED, ["seq"], 9)).toBe(
      `SELECT ${projected("seq")} FROM "counted_rows" AS t WHERE t."seq" > 9 ORDER BY t."seq" LIMIT 512`,
    );
  });

  it("seeks past a byte-array cursor as a blob literal", () => {
    expect(verificationSelect({ name: "auth_users", key: "id", columns: ["id", "email"], pageRows: 256 }, ["id"], [0, 17, 255])).toBe(
      `SELECT ${projected("id")} FROM "auth_users" AS t WHERE t."id" > X'0011ff' ORDER BY t."id" LIMIT 256`,
    );
    expect(verificationSelect({ name: "auth_users", key: "id", columns: ["id", "email"], pageRows: 256 }, ["id"], [])).toBe(
      `SELECT ${projected("id")} FROM "auth_users" AS t WHERE t."id" > X'' ORDER BY t."id" LIMIT 256`,
    );
  });

  it("escapes a caller-supplied key in the cursor", () => {
    expect(verificationSelect({ name: "keys", key: "key", columns: ["key"], pageRows: 256 }, ["key"], "a'b")).toBe(
      `SELECT ${projected("key")} FROM "keys" AS t WHERE t."key" > 'a''b' ORDER BY t."key" LIMIT 256`,
    );
  });

  it("doubles a quote in a column name, in the value projection and in the type alias alike", () => {
    expect(verificationSelect(UUID_KEYED, ['od"d'], null)).toBe(
      `SELECT CASE WHEN typeof("od""d")='blob' THEN hex("od""d") ELSE "od""d" END AS "od""d", typeof("od""d") AS "forge:type:od""d" FROM "tasks" AS t ORDER BY t."uuid" LIMIT 256`,
    );
  });
});

describe("decodeReadRow()", () => {
  it("turns a blob column's hex back into bytes and drops the type projections", () => {
    expect(decodeReadRow(["id", "email"], { id: "5A0A55C8", "forge:type:id": "blob", email: "a@example.com", "forge:type:email": "text" })).toEqual(
      { id: [90, 10, 85, 200], email: "a@example.com" },
    );
  });

  it("keeps a text value that looks like a byte array as text", () => {
    expect(decodeReadRow(["note"], { note: "[90, 10, 85, 200]", "forge:type:note": "text" })).toEqual({ note: "[90, 10, 85, 200]" });
  });

  it("carries an integer and a NULL through untouched, and wraps a real whatever its value", () => {
    expect(
      decodeReadRow(["seq", "ratio", "whole", "gone"], {
        seq: 7,
        "forge:type:seq": "integer",
        ratio: 1.5,
        "forge:type:ratio": "real",
        whole: 1,
        "forge:type:whole": "real",
        gone: null,
        "forge:type:gone": "null",
      }),
    ).toEqual({ seq: 7, ratio: new SqlReal(1.5), whole: new SqlReal(1), gone: null });
  });

  it("throws on every tag the value contradicts, rather than restoring the wrong value silently", () => {
    const mismatches: [Record<string, unknown>, string][] = [
      [{ v: null, "forge:type:v": "real" }, "the column reads as real and its value is null, which is not a number"],
      [{ v: "7", "forge:type:v": "integer" }, 'the column reads as integer and its value is "7", which is not a number'],
      [{ v: 7, "forge:type:v": "text" }, "the column reads as text and its value is 7, which is not a string"],
      [{ v: 0, "forge:type:v": "null" }, "the column reads as null and its value is 0"],
      [{ v: 1, "forge:type:v": "numeric" }, 'the column\'s storage class reads as "numeric", which is not one SQLite reports'],
    ];
    for (const [row, reason] of mismatches) {
      const thrown = capture(() => decodeReadRow(["v"], row));
      expect(thrown).toBeInstanceOf(UnsupportedValue);
      expect((thrown as Error).message).toBe(`v: ${reason}`);
    }
  });

  it("decodes an empty blob as no bytes", () => {
    expect(decodeReadRow(["id"], { id: "", "forge:type:id": "blob" })).toEqual({ id: [] });
  });

  it("throws when the type projection is missing, the same way an absent column does", () => {
    expect((capture(() => decodeReadRow(["id"], { id: "00" })) as Error).message).toBe(
      "id: the column's type projection is absent from the row — the read did not return it",
    );
    expect((capture(() => decodeReadRow(["id"], { "forge:type:id": "blob" })) as Error).message).toBe(
      "id: the column is absent from the row — the read did not return it",
    );
  });

  it("throws when a column reads as a blob and its hex projection is not hex", () => {
    expect((capture(() => decodeReadRow(["id"], { id: "zz", "forge:type:id": "blob" })) as Error).message).toBe(
      'id: the column reads as a blob and its hex projection is "zz"',
    );
  });
});

const PREAMBLE = "PRAGMA defer_foreign_keys=TRUE;";
const CLEAR_SEQUENCE = "DELETE FROM sqlite_sequence;";

const SCHEMA_DUMP = [
  PREAMBLE,
  "CREATE TABLE projects (uuid TEXT PRIMARY KEY);",
  "CREATE TABLE counted_rows (seq INTEGER PRIMARY KEY AUTOINCREMENT);",
  CLEAR_SEQUENCE,
];

describe("checkSchemaArtifact()", () => {
  it("passes a well-formed schema dump", () => {
    expect(checkSchemaArtifact(SCHEMA_DUMP.join("\n"))).toEqual([]);
  });

  it("reports a file that does not open with wrangler's preamble", () => {
    expect(checkSchemaArtifact(SCHEMA_DUMP.slice(1).join("\n"))).toEqual([
      { line: 1, reason: "the first line is not PRAGMA defer_foreign_keys=TRUE; — this is not a wrangler dump" },
    ]);
  });

  // The load-bearing rule: route full loads this file and then data.sql, so a schema that grew rows
  // would restore them twice.
  it("reports every INSERT, naming the table each one carries a row of", () => {
    const grown = [...SCHEMA_DUMP, `INSERT INTO "projects" VALUES('p');`, `INSERT INTO "sqlite_sequence" VALUES('counted_rows',124);`];

    expect(checkSchemaArtifact(grown.join("\n"))).toEqual([
      {
        line: 5,
        reason: "an INSERT into projects — a schema artifact declares tables and carries no row, because route full loads data.sql after it",
      },
      {
        line: 6,
        reason: "an INSERT into sqlite_sequence — a schema artifact declares tables and carries no row, because route full loads data.sql after it",
      },
    ]);
  });

  it("reports a schema that declares no table at all, rather than leaving data.sql to fail row by row", () => {
    expect(checkSchemaArtifact(PREAMBLE)).toEqual([
      { line: 1, reason: "no CREATE TABLE at all — this cannot be the schema route full loads data.sql into" },
    ]);
  });

  it("passes a schema from a database with no AUTOINCREMENT table, where sqlite_sequence does not exist", () => {
    expect(checkSchemaArtifact([PREAMBLE, "CREATE TABLE projects (uuid TEXT PRIMARY KEY);"].join("\n"))).toEqual([]);
  });

  it("reports a schema that clears sqlite_sequence twice", () => {
    expect(checkSchemaArtifact([...SCHEMA_DUMP, CLEAR_SEQUENCE].join("\n"))).toEqual([
      { line: 5, reason: "sqlite_sequence is cleared 2 times and should be cleared once" },
    ]);
  });

  it("reports a clear that lands before the last CREATE TABLE, where it would be undone", () => {
    expect(checkSchemaArtifact([PREAMBLE, CLEAR_SEQUENCE, ...SCHEMA_DUMP.slice(1, 3)].join("\n"))).toEqual([
      { line: 2, reason: "sqlite_sequence is cleared at line 2, before the last CREATE TABLE at line 4" },
    ]);
  });

  it("reports a row-removal statement that is not the sequence clear", () => {
    expect(checkSchemaArtifact([...SCHEMA_DUMP, "DELETE FROM task_reviews;"].join("\n"))).toEqual([
      { line: 5, reason: "an unexpected row-removal statement in a schema: DELETE FROM task_reviews;" },
    ]);
  });

  it("reads a trigger whose body deletes rows as one statement, and still faults a bare DELETE after it", () => {
    const trigger = ["CREATE TRIGGER sessions_sweep AFTER INSERT ON sessions BEGIN", "  DELETE FROM sessions WHERE expires < NEW.now;", "END;"];
    expect(checkSchemaArtifact([...SCHEMA_DUMP.slice(0, 3), ...trigger, ...SCHEMA_DUMP.slice(3)].join("\n"))).toEqual([]);
    expect(checkSchemaArtifact([...SCHEMA_DUMP.slice(0, 3), ...trigger, ...SCHEMA_DUMP.slice(3), "DELETE FROM users;"].join("\n"))).toEqual([
      { line: 8, reason: "an unexpected row-removal statement in a schema: DELETE FROM users;" },
    ]);
  });

  it("reports a virtual table declaration, which cannot be restored", () => {
    const dump = [...SCHEMA_DUMP.slice(0, 3), "CREATE VIRTUAL TABLE tasks_fts USING fts5(summary);", ...SCHEMA_DUMP.slice(3)];

    expect(checkSchemaArtifact(dump.join("\n"))).toEqual([{ line: 4, reason: "a virtual table cannot be dumped or restored" }]);
  });
});

const DATA_DUMP = [PREAMBLE, `INSERT INTO "projects" VALUES('p','ledger',NULL,'2026-08-06');`, `INSERT INTO "tasks" VALUES('t');`];

const SEQUENCE_REASON =
  "sqlite_sequence is the engine's and is restored only by schema.sql, which clears it first — an insert here would duplicate a row in a table with no UNIQUE index on name";

describe("checkDataArtifact()", () => {
  it("passes an artifact holding only rows of the tables it may carry", () => {
    expect(checkDataArtifact(DATA_DUMP.join("\n"), APP_TABLES)).toEqual([]);
  });

  it("reports a file that does not open with wrangler's preamble", () => {
    expect(checkDataArtifact(DATA_DUMP.slice(1).join("\n"), APP_TABLES)).toEqual([
      { line: 1, reason: "the first line is not PRAGMA defer_foreign_keys=TRUE; — this is not a wrangler dump" },
    ]);
  });

  it("gives sqlite_sequence its own reason, even when the caller's allowlist names it", () => {
    const dump = [...DATA_DUMP, `INSERT INTO "sqlite_sequence" VALUES('c',124);`];

    expect(checkDataArtifact(dump.join("\n"), [...APP_TABLES, "sqlite_sequence"])).toEqual([{ line: 4, reason: SEQUENCE_REASON }]);
  });

  it("gives an unquoted insert the same reason as the quoted form", () => {
    const cases = [
      { table: "sqlite_sequence", reason: SEQUENCE_REASON },
      { table: "task_reviews", reason: "task_reviews is not one of the tables this artifact may carry" },
    ];
    for (const { table, reason } of cases) {
      expect(checkDataArtifact([...DATA_DUMP, `INSERT INTO ${table} VALUES(1);`].join("\n"), APP_TABLES)).toEqual([{ line: 4, reason }]);
      expect(checkDataArtifact([...DATA_DUMP, `INSERT INTO "${table}" VALUES(1);`].join("\n"), APP_TABLES)).toEqual([{ line: 4, reason }]);
    }
  });

  it("reads an INSERT the old prefix check would have walked past: lowercase, indented, and OR-qualified", () => {
    const slipped = [
      `insert into "sqlite_sequence" VALUES(1);`,
      `   INSERT INTO "sqlite_sequence" VALUES(1);`,
      `INSERT OR REPLACE INTO "sqlite_sequence" VALUES(1);`,
      `INSERT\tOR IGNORE\tINTO sqlite_sequence VALUES(1);`,
    ];
    for (const line of slipped) {
      expect(checkDataArtifact([...DATA_DUMP, line].join("\n"), APP_TABLES)).toEqual([{ line: 4, reason: SEQUENCE_REASON }]);
    }
  });

  it("accepts a doubled quote in a quoted table name, which is how the name is written", () => {
    expect(checkDataArtifact([...DATA_DUMP, `INSERT INTO "od""d" VALUES(1);`].join("\n"), [...APP_TABLES, 'od"d'])).toEqual([]);
    expect(checkDataArtifact([...DATA_DUMP, `INSERT INTO "od""d" VALUES(1);`].join("\n"), APP_TABLES)).toEqual([
      { line: 4, reason: 'od"d is not one of the tables this artifact may carry' },
    ]);
  });

  it("matches an allow-listed table without regard to case, as the manifest keys it", () => {
    expect(checkDataArtifact([...DATA_DUMP, `INSERT INTO "TASKS" VALUES(1);`].join("\n"), APP_TABLES)).toEqual([]);
  });

  it("faults an INSERT line it cannot read a table out of, rather than passing it", () => {
    const unreadable = [`INSERT INTO 'tasks' VALUES(1);`, `INSERT INTO (SELECT 1);`, `INSERT VALUES(1);`];
    for (const line of unreadable) {
      const faults = checkDataArtifact([...DATA_DUMP, line].join("\n"), APP_TABLES);
      expect(faults.length).toBe(1);
      expect(faults[0]?.line).toBe(4);
      expect(faults[0]?.reason.startsWith("an INSERT naming no table this scan can read: ")).toBe(true);
    }
  });

  it("passes an insert carrying a blob literal, which is what a BLOB key is written as", () => {
    const line = `INSERT INTO "tasks" ("id","lane") VALUES (X'00112233445566778899aabbccddeeff','todo');`;

    expect(checkDataArtifact([...DATA_DUMP, line].join("\n"), APP_TABLES)).toEqual([]);
  });

  it("passes an unquoted insert into a table the allowlist carries", () => {
    expect(checkDataArtifact([...DATA_DUMP, "INSERT INTO tasks VALUES(1);"].join("\n"), APP_TABLES)).toEqual([]);
  });

  it("carries forge's companion tables when the caller allows them", () => {
    expect(
      checkDataArtifact([...DATA_DUMP, `INSERT INTO "_forge_migrations" VALUES('0001_init','ab');`].join("\n"), [
        ...APP_TABLES,
        "_forge_migrations",
      ]),
    ).toEqual([]);
  });

  it("reports a statement naming sqlite_sequence, on the line it appears", () => {
    expect(checkDataArtifact([...DATA_DUMP, "UPDATE sqlite_sequence SET seq = 124;"].join("\n"), APP_TABLES)).toEqual([
      { line: 4, reason: SEQUENCE_REASON },
    ]);
  });

  it("leaves a data row alone whose own text names the managed table and a removal statement", () => {
    const prose = "the dump must clear sqlite_sequence; never DELETE FROM tasks;";

    expect(checkDataArtifact([...DATA_DUMP, `INSERT INTO "tasks" VALUES('t','${prose}');`].join("\n"), APP_TABLES)).toEqual([]);
  });

  it("passes an artifact this module authored whose rows hold newlines and name the managed table", () => {
    const rows = [
      { uuid: "t1", details: "the dump must clear sqlite_sequence\nbefore it inserts into it" },
      { uuid: "t2", details: `never DELETE FROM tasks;\r\npath C:${BACKSLASH_N}otes` },
    ];
    const artifact = [PREAMBLE, ...rows.map((row) => insertStatement("tasks", ["uuid", "details"], row))].join("\n");

    expect(artifact.split("\n").length).toBe(3);
    expect(checkDataArtifact(artifact, APP_TABLES)).toEqual([]);
  });

  it("reports a schema declaration and a row removal, which a data-only artifact holds neither of", () => {
    expect(checkDataArtifact([...DATA_DUMP, "CREATE TABLE projects (uuid TEXT PRIMARY KEY);"].join("\n"), APP_TABLES)).toEqual([
      { line: 4, reason: "a data-only artifact declares no schema — the migrations route applies the migrations directory first" },
    ]);
    expect(checkDataArtifact([...DATA_DUMP, "DELETE FROM projects;"].join("\n"), APP_TABLES)).toEqual([
      { line: 4, reason: "a data-only artifact removes nothing: DELETE FROM projects;" },
    ]);
  });

  it("reports a DROP and an ALTER on the same terms as a CREATE, since all three are the migrations route's", () => {
    const reason = "a data-only artifact declares no schema — the migrations route applies the migrations directory first";

    expect(checkDataArtifact([...DATA_DUMP, 'DROP TABLE "orders";'].join("\n"), APP_TABLES)).toEqual([{ line: 4, reason }]);
    expect(checkDataArtifact([...DATA_DUMP, "ALTER TABLE tasks ADD COLUMN x TEXT;"].join("\n"), APP_TABLES)).toEqual([{ line: 4, reason }]);
  });

  // The judgement is an allowlist and not a list of verbs somebody thought of: the file is handed to
  // `wrangler d1 execute --file`, and each of these returned no fault while it was a denylist.
  it("refuses a verb no arm names, because only the preamble and an allowed INSERT pass", () => {
    const refused = [
      "REPLACE INTO tasks VALUES(1);",
      "UPDATE tasks SET lane = 'done';",
      "ATTACH DATABASE 'evil.db' AS evil;",
      "PRAGMA writable_schema=ON;",
      "WITH c AS (SELECT 1) INSERT INTO orders SELECT * FROM c;",
    ];
    for (const statement of refused) {
      expect(checkDataArtifact([...DATA_DUMP, statement].join("\n"), APP_TABLES)).toEqual([
        { line: 4, reason: `a data artifact carries only the preamble and INSERTs: ${statement}` },
      ]);
    }
  });

  // The verb was matched against the raw text, so a comment ahead of it matched no arm at all — not
  // the INSERT arm that checks the table, and not one of the denied ones either.
  it("reads an INSERT behind a comment rather than passing it, whatever table it names", () => {
    const faults = checkDataArtifact([...DATA_DUMP, "/*c*/INSERT INTO orders VALUES(1);"].join("\n"), APP_TABLES);

    expect(faults.length).toBe(1);
    expect(faults[0]?.line).toBe(4);
    expect(faults[0]?.reason.startsWith("an INSERT naming no table this scan can read: ")).toBe(true);
  });

  it("admits the preamble only as the file's own first statement", () => {
    expect(checkDataArtifact([...DATA_DUMP, PREAMBLE].join("\n"), APP_TABLES)).toEqual([
      { line: 4, reason: `a data artifact carries only the preamble and INSERTs: ${PREAMBLE}` },
    ]);
  });
});

// A line scan reads a crafted dump as one INSERT and stops there; the artifact is what `wrangler d1
// execute --file` is handed, so every statement on the line has to be judged, not just the first.
describe("checkDataArtifact() — a second statement hidden on an INSERT's line", () => {
  it("reports a row removal written after an allowed INSERT on the same line", () => {
    const line = `INSERT INTO "tasks" (id) VALUES (1); DROP TABLE "orders";`;

    expect(checkDataArtifact([...DATA_DUMP, line].join("\n"), APP_TABLES)).toEqual([
      { line: 4, reason: "a data-only artifact declares no schema — the migrations route applies the migrations directory first" },
    ]);
  });

  it("reports an INSERT into a table it may not carry when that INSERT is the line's second statement", () => {
    const line = `INSERT INTO "tasks" (id) VALUES (1); INSERT INTO "secrets" (id) VALUES (1);`;

    expect(checkDataArtifact([...DATA_DUMP, line].join("\n"), APP_TABLES)).toEqual([
      { line: 4, reason: "secrets is not one of the tables this artifact may carry" },
    ]);
  });

  it("reports a DELETE hidden after an INSERT, which the line scan read as part of the row", () => {
    const line = `INSERT INTO "tasks" (id) VALUES (1); DELETE FROM "projects";`;

    expect(checkDataArtifact([...DATA_DUMP, line].join("\n"), APP_TABLES)).toEqual([
      { line: 4, reason: 'a data-only artifact removes nothing: DELETE FROM "projects";' },
    ]);
  });

  it("still passes a row whose own literal holds the semicolon that would end a statement", () => {
    const line = `INSERT INTO "tasks" VALUES('t','a;b');`;

    expect(checkDataArtifact([...DATA_DUMP, line].join("\n"), APP_TABLES)).toEqual([]);
  });

  it("judges an INSERT written across several lines, and reports it at the line it opens on", () => {
    const statement = ['INSERT INTO "secrets"', "  (id)", "VALUES", "  (1);"].join("\n");

    expect(checkDataArtifact([...DATA_DUMP, statement].join("\n"), APP_TABLES)).toEqual([
      { line: 4, reason: "secrets is not one of the tables this artifact may carry" },
    ]);
  });

  it("passes an allowed INSERT whose literal holds a raw newline, which is not a statement break", () => {
    const statement = `INSERT INTO "tasks" VALUES('t','one\ntwo; DELETE FROM projects;');`;

    expect(checkDataArtifact([...DATA_DUMP, statement].join("\n"), APP_TABLES)).toEqual([]);
  });
});

const SCHEMA_DIGEST = "a".repeat(64);
const MIGRATIONS_DIGEST = "b".repeat(64);

const ON_DISK: SchemaFacts = { migrations: ["0001_init", "0002_later"], digest: SCHEMA_DIGEST, migrationsDigest: MIGRATIONS_DIGEST };

const MANIFEST: BackupManifest = {
  formatVersion: BACKUP_FORMAT_VERSION,
  drift: "match" as const,
  createdAt: "2026-08-06T09:07:05.123Z",
  label: null,
  dumper: { tool: "forge db backup", version: "4.105.0" },
  database: { name: "app-db", id: null, target: "local", persistPath: ".wrangler/state" },
  schema: ON_DISK,
  migrations: [{ name: "0001_init", sha256: MIGRATIONS_DIGEST }],
  tables: [{ name: "tasks", rows: 218, digest: SCHEMA_DIGEST }],
  artifacts: [{ file: "schema.sql", bytes: 1024, sha256: SCHEMA_DIGEST }],
  warnings: [],
  verified: [{ route: "full", divergent: 0 }],
  selfDigest: "e".repeat(64),
};

function manifestJson(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { ...MANIFEST, ...overrides };
}

describe("validateManifest()", () => {
  it("accepts the manifest this tool writes", () => {
    expect(validateManifest(MANIFEST)).toEqual([]);
  });

  it("refuses a value that is not a JSON object, and says nothing else about it", () => {
    expect([validateManifest("{}"), validateManifest(null), validateManifest([MANIFEST])]).toEqual([
      ["the manifest is not a JSON object"],
      ["the manifest is not a JSON object"],
      ["the manifest is not a JSON object"],
    ]);
  });

  it("refuses a formatVersion this tool does not write, including a missing one", () => {
    expect(validateManifest(manifestJson({ formatVersion: 1 }))).toEqual([
      `formatVersion is 1 and this tool writes ${BACKUP_FORMAT_VERSION} — take the backup again, since full.sql is gone and route full now loads schema.sql then data.sql`,
    ]);
    const value = manifestJson();
    delete value.formatVersion;

    expect(validateManifest(value)).toEqual([
      `formatVersion is undefined and this tool writes ${BACKUP_FORMAT_VERSION} — take the backup again, since full.sql is gone and route full now loads schema.sql then data.sql`,
    ]);
  });

  it("refuses a migrations list that is not a list of named, hashed migrations", () => {
    expect(validateManifest(manifestJson({ migrations: [{}] }))).toEqual([
      "migrations[0].name is missing",
      "migrations[0].sha256 is not a 64-character hex SHA-256",
    ]);
  });

  it("refuses a migration name that climbs out of the artifact", () => {
    expect(validateManifest(manifestJson({ migrations: [{ name: "../x", sha256: MIGRATIONS_DIGEST }] }))).toEqual([
      'migrations[0].name "../x" is not a migration name — <NNNN>_<name>, with no path separator',
    ]);
  });

  it("refuses a migration name holding a path separator, even under a number", () => {
    expect(validateManifest(manifestJson({ migrations: [{ name: "0001_a/b", sha256: MIGRATIONS_DIGEST }] }))).toEqual([
      'migrations[0].name "0001_a/b" is not a migration name — <NNNN>_<name>, with no path separator',
    ]);
    expect(validateManifest(manifestJson({ migrations: [{ name: "a/b", sha256: MIGRATIONS_DIGEST }] }))).toEqual([
      'migrations[0].name "a/b" is not a migration name — <NNNN>_<name>, with no path separator',
    ]);
  });

  it("refuses a migration name that is not <NNNN>_<name>, and names the index", () => {
    expect(
      validateManifest(
        manifestJson({
          migrations: [
            { name: "0001_init", sha256: MIGRATIONS_DIGEST },
            { name: "init", sha256: MIGRATIONS_DIGEST },
          ],
        }),
      ),
    ).toEqual(['migrations[1].name "init" is not a migration name — <NNNN>_<name>, with no path separator']);
  });

  it("refuses an artifact entry that declares nothing", () => {
    expect(validateManifest(manifestJson({ artifacts: [{}] }))).toEqual([
      "artifacts[0].file undefined is not a file name — letters, digits, dot, underscore and hyphen only",
      "artifacts[0].bytes is not a byte count",
      "artifacts[0].sha256 is not a 64-character hex SHA-256",
    ]);
  });

  it("refuses an artifact file that is a path rather than a name", () => {
    expect(validateManifest(manifestJson({ artifacts: [{ file: "../../.env", bytes: 1, sha256: SCHEMA_DIGEST }] }))).toEqual([
      'artifacts[0].file "../../.env" is not a file name — letters, digits, dot, underscore and hyphen only',
    ]);
    expect(validateManifest(manifestJson({ artifacts: [{ file: "..", bytes: 1, sha256: SCHEMA_DIGEST }] }))).toEqual([
      'artifacts[0].file ".." is not a file name — letters, digits, dot, underscore and hyphen only',
    ]);
    expect(validateManifest(manifestJson({ artifacts: [{ file: ".", bytes: 1, sha256: SCHEMA_DIGEST }] }))).toEqual([
      'artifacts[0].file "." is not a file name — letters, digits, dot, underscore and hyphen only',
    ]);
  });

  it("refuses a table entry with a negative row count, a missing name or a bad digest", () => {
    expect(validateManifest(manifestJson({ tables: [{ name: "tasks", rows: -1, digest: SCHEMA_DIGEST }] }))).toEqual([
      "tables[0].rows is not a row count",
    ]);
    expect(validateManifest(manifestJson({ tables: [{ rows: 1.5, digest: "x" }] }))).toEqual([
      "tables[0].name is missing",
      "tables[0].rows is not a row count",
      "tables[0].digest is not a 64-character hex SHA-256",
    ]);
  });

  it("refuses a verified entry naming a route this tool has none of, or a divergence that is not a count", () => {
    expect(validateManifest(manifestJson({ verified: [{ route: "partial", divergent: 0 }] }))).toEqual([
      "verified[0].route is not full or migrations",
    ]);
    expect(validateManifest(manifestJson({ verified: [{ route: "migrations", divergent: -1 }] }))).toEqual([
      "verified[0].divergent is not a count",
    ]);
    expect(validateManifest(manifestJson({ verified: [null] }))).toEqual([
      "verified[0].route is not full or migrations",
      "verified[0].divergent is not a count",
    ]);
  });

  it("refuses a createdAt that is not an instant", () => {
    expect(validateManifest(manifestJson({ createdAt: "yesterday" }))).toEqual(["createdAt is not an ISO 8601 instant"]);
  });

  it("refuses a missing database block, and names each missing field of a present one", () => {
    const value = manifestJson();
    delete value.database;

    expect(validateManifest(value)).toEqual(["database is missing"]);
    expect(validateManifest(manifestJson({ database: { id: null, persistPath: null } }))).toEqual([
      "database.name is missing",
      "database.target is missing",
    ]);
  });

  it("refuses a missing schema block", () => {
    const value = manifestJson();
    delete value.schema;

    expect(validateManifest(value)).toEqual(["schema is missing"]);
  });

  it("refuses a digest that is not 64 hex characters", () => {
    expect(validateManifest(manifestJson({ schema: { ...ON_DISK, digest: "a".repeat(63) } }))).toEqual([
      "schema.digest is not a 64-character hex SHA-256",
    ]);
    expect(validateManifest(manifestJson({ schema: { ...ON_DISK, migrationsDigest: `${"b".repeat(63)}z` } }))).toEqual([
      "schema.migrationsDigest is not a 64-character hex SHA-256",
    ]);
  });

  it("refuses a selfDigest that is not a SHA-256, including a missing one", () => {
    const value = manifestJson();
    delete value.selfDigest;
    expect([validateManifest(manifestJson({ selfDigest: "short" })), validateManifest(value)]).toEqual([
      ["selfDigest is not a 64-character hex SHA-256"],
      ["selfDigest is not a 64-character hex SHA-256"],
    ]);
  });

  it("refuses a migrations list that is not an array", () => {
    expect(validateManifest(manifestJson({ schema: { ...ON_DISK, migrations: "0001_init" } }))).toEqual(["schema.migrations is not an array"]);
  });

  it("names each of the four list fields that is not an array", () => {
    expect(validateManifest(manifestJson({ tables: null, artifacts: null, warnings: null, verified: null }))).toEqual([
      "tables is not an array",
      "artifacts is not an array",
      "warnings is not an array",
      "verified is not an array",
    ]);
  });
});

describe("manifestSelfDigest()", () => {
  it("ignores the field it fills, so writer and reader compute the same digest", () => {
    const written = { ...MANIFEST, selfDigest: manifestSelfDigest(MANIFEST) };

    expect(manifestSelfDigest(written)).toBe(written.selfDigest);
  });

  it("changes when any other field does", () => {
    expect(manifestSelfDigest({ ...MANIFEST, label: "before the cut" })).not.toBe(manifestSelfDigest(MANIFEST));
  });
});

describe("appSchemaDigestInput()", () => {
  it("covers the app's own objects and neither the sequence nor forge's own companion tables", () => {
    const objects: SchemaObject[] = [
      { type: "table", name: "tasks", tblName: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY)" },
      { type: "table", name: "sqlite_sequence", tblName: "sqlite_sequence", sql: "CREATE TABLE sqlite_sequence(name,seq)" },
      { type: "table", name: "_forge_migrations", tblName: "_forge_migrations", sql: "CREATE TABLE _forge_migrations (id INTEGER PRIMARY KEY)" },
    ];

    expect(appSchemaDigestInput(objects)).toBe(schemaDigestInput(objects.slice(0, 1)));
  });
});

describe("compareManifests()", () => {
  it("finds nothing when all three bindings hold", () => {
    expect(compareManifests(MANIFEST, ON_DISK)).toEqual([]);
  });

  it("reports all three at once, each by name", () => {
    expect(compareManifests(MANIFEST, { migrations: [], digest: "c".repeat(64), migrationsDigest: "d".repeat(64) })).toEqual([
      "migrations: the artifact was taken from [0001_init, 0002_later] and this database has []",
      "schema digest: the declarations differ — a schema changed without a migration on one side",
      "migrations digest: the same migration names hash differently — an applied migration's file has been edited, which a forward-only migrations directory forbids",
    ]);
  });

  it("reports a migrations list the database does not carry", () => {
    expect(compareManifests(MANIFEST, { ...ON_DISK, migrations: ["0001_init"] })).toEqual([
      "migrations: the artifact was taken from [0001_init, 0002_later] and this database has [0001_init]",
    ]);
  });
});

describe("isVerifiedBackupOf()", () => {
  it("accepts a manifest whose own run proved a route clean", () => {
    expect(isVerifiedBackupOf(MANIFEST, "app-db")).toBe(true);
  });

  it("refuses a manifest for a different database, one that verified nothing, and one that diverged", () => {
    expect(isVerifiedBackupOf(MANIFEST, "other-db")).toBe(false);
    expect(isVerifiedBackupOf({ ...MANIFEST, verified: [] }, "app-db")).toBe(false);
    expect(
      isVerifiedBackupOf(
        {
          ...MANIFEST,
          verified: [
            { route: "full", divergent: 0 },
            { route: "migrations", divergent: 3 },
          ],
        },
        "app-db",
      ),
    ).toBe(false);
  });
});

describe("formatBackupDirectory()", () => {
  it("stamps a sortable second-resolution instant onto the database name, dropping sub-second precision", () => {
    expect(formatBackupDirectory("app-db", new Date("2026-08-06T09:07:05.123Z"))).toBe("app-db-20260806T090705Z");
    expect(formatBackupDirectory("app-db", new Date("2026-08-06T09:07:05.999Z"))).toBe("app-db-20260806T090705Z");
  });

  it("sorts lexicographically in the order the backups were taken", () => {
    const earlier = formatBackupDirectory("app-db", new Date("2026-08-06T09:07:05.000Z"));
    const later = formatBackupDirectory("app-db", new Date("2026-08-06T10:00:00.000Z"));

    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});

const NO_ROWS: Readonly<Record<string, number>> = { projects: 0, epics: 0, tasks: 0 };

describe("checkRestoreTarget()", () => {
  it("passes route full against a database with no app table, managed tables notwithstanding", () => {
    const objects: SchemaObject[] = [
      { type: "table", name: "_forge_migrations", tblName: "_forge_migrations", sql: "CREATE TABLE _forge_migrations (id INTEGER)" },
    ];

    expect(checkRestoreTarget("full", objects, {}, APP_TABLES)).toEqual([]);
  });

  it("refuses route full against a target that already declares app tables, even empty ones", () => {
    expect(checkRestoreTarget("full", healthyInventory(), NO_ROWS, APP_TABLES)).toEqual([
      "the target already declares 3 app table(s) — route full loads a whole database and needs one with none: epics, projects, tasks",
    ]);
    expect(checkRestoreTarget("full", [appObject("tasks")], { tasks: 0 }, APP_TABLES)).toEqual([
      "the target already declares 1 app table(s) — route full loads a whole database and needs one with none: tasks",
    ]);
  });

  it("passes route migrations against a target with every expected table present and empty", () => {
    expect(checkRestoreTarget("migrations", healthyInventory(), NO_ROWS, APP_TABLES)).toEqual([]);
    expect(checkRestoreTarget("migrations", healthyInventory(), {}, APP_TABLES)).toEqual([]);
  });

  it("refuses route migrations when an expected table is missing", () => {
    const objects = healthyInventory().filter((object) => object.name !== "tasks");

    expect(checkRestoreTarget("migrations", objects, NO_ROWS, APP_TABLES)).toEqual([
      "tasks is missing — route migrations needs the migrations directory applied first",
    ]);
  });

  it("reports every non-empty table, in name order", () => {
    expect(checkRestoreTarget("migrations", healthyInventory(), { ...NO_ROWS, tasks: 218, epics: 4 }, APP_TABLES)).toEqual([
      "epics already holds 4 row(s) — a restore adds rows and never removes them, so the target must be empty",
      "tasks already holds 218 row(s) — a restore adds rows and never removes them, so the target must be empty",
    ]);
  });
});

describe("verifyBackupArtifact()", () => {
  const DATA_SQL = "PRAGMA defer_foreign_keys=TRUE;\n";
  const SCHEMA_SQL = [
    "PRAGMA defer_foreign_keys=TRUE;",
    "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);",
    "DELETE FROM sqlite_sequence;",
    "",
  ].join("\n");

  const declares = (file: string, text: string) => ({ file, bytes: new TextEncoder().encode(text).length, sha256: sha256(text) });

  function artifact(over: Partial<BackupManifest> = {}): BackupManifest {
    const written = {
      ...MANIFEST,
      migrations: [{ name: "0001_init", sha256: MIGRATIONS_DIGEST }],
      tables: [{ name: "tasks", rows: 0, digest: SCHEMA_DIGEST }],
      artifacts: [declares("schema.sql", SCHEMA_SQL), declares("data.sql", DATA_SQL)],
      ...over,
      selfDigest: "",
    };
    return { ...written, selfDigest: manifestSelfDigest(written) };
  }

  function io(files: Record<string, string>): DbIo {
    const store = new Map(Object.entries(files));
    return {
      ...fakeDbIo(files),
      exists: (path: string) => store.has(path) || [...store.keys()].some((key) => key.startsWith(`${path}/`)),
      readText: (path: string) => store.get(path) ?? "",
      readDir: (path: string) => [
        ...new Set([...store.keys()].filter((key) => key.startsWith(`${path}/`)).map((key) => key.slice(path.length + 1).split("/")[0] ?? "")),
      ],
    } as DbIo;
  }

  const files = (dir: string) => ({ [`${dir}/schema.sql`]: SCHEMA_SQL, [`${dir}/data.sql`]: DATA_SQL });

  it("accepts the artifact this tool writes", () => {
    expect(() => verifyBackupArtifact(io(files("/b")), "/b", artifact())).not.toThrow();
  });

  // `takeBackup` writes both files for every backup, unconditionally, so a manifest declaring none
  // is not something this tool produced. The loop this replaced had nothing to iterate and passed.
  it("refuses a manifest that declares no files at all, rather than verifying it vacuously", () => {
    expect(() => verifyBackupArtifact(io(files("/b")), "/b", artifact({ artifacts: [] }))).toThrow(/declares no schema.sql and no data.sql/);
  });

  it("refuses a manifest that declares only one of the two", () => {
    expect(() => verifyBackupArtifact(io(files("/b")), "/b", artifact({ artifacts: [declares("data.sql", DATA_SQL)] }))).toThrow(
      /declares no schema.sql/,
    );
  });

  it("refuses a declared file no restore route loads", () => {
    const extra = { ...files("/b"), "/b/notes.sql": "SELECT 1;\n" };
    const manifest = artifact({
      artifacts: [declares("schema.sql", SCHEMA_SQL), declares("data.sql", DATA_SQL), declares("notes.sql", "SELECT 1;\n")],
    });

    expect(() => verifyBackupArtifact(io(extra), "/b", manifest)).toThrow(/not a file any restore route loads/);
  });

  it("refuses an undeclared .sql sitting beside the declared ones", () => {
    expect(() => verifyBackupArtifact(io({ ...files("/b"), "/b/extra.sql": "DROP TABLE tasks;\n" }), "/b", artifact())).toThrow(
      /holds extra.sql, which the manifest does not declare/,
    );
  });

  // Route `migrations` executes what it finds in here, so the rule has to reach one directory down.
  it("refuses an undeclared .sql under migrations/, which a restore executes by listing it", () => {
    const seeded = {
      ...files("/b"),
      "/b/migrations/0001_init.sql": "CREATE TABLE tasks (uuid TEXT);\n",
      "/b/migrations/zzz.sql": "DROP TABLE tasks;\n",
    };

    expect(() => verifyBackupArtifact(io(seeded), "/b", artifact())).toThrow(/holds zzz.sql, which the manifest does not declare/);
  });

  it("accepts a migrations/ holding exactly what the manifest declares", () => {
    const seeded = { ...files("/b"), "/b/migrations/0001_init.sql": "CREATE TABLE tasks (uuid TEXT);\n" };

    expect(() => verifyBackupArtifact(io(seeded), "/b", artifact())).not.toThrow();
  });

  it("still refuses a declared file whose bytes do not hash to what the manifest says", () => {
    expect(() => verifyBackupArtifact(io({ ...files("/b"), "/b/data.sql": `${DATA_SQL}-- edited\n` }), "/b", artifact())).toThrow(
      /does not hash to what the manifest declares for it/,
    );
  });

  it("still refuses a schema.sql that is not a schema-only artifact", () => {
    const schema = `${SCHEMA_SQL}INSERT INTO "tasks" VALUES('t1','todo');\n`;

    expect(() =>
      verifyBackupArtifact(
        io({ ...files("/b"), "/b/schema.sql": schema }),
        "/b",
        artifact({ artifacts: [declares("schema.sql", schema), declares("data.sql", DATA_SQL)] }),
      ),
    ).toThrow(
      "schema.sql is not what a schema-only artifact must be:\n  line 4: an INSERT into tasks — a schema artifact declares tables and carries no row, because route full loads data.sql after it",
    );
  });

  it("still refuses a data.sql that is not a data-only artifact", () => {
    const data = `${DATA_SQL}INSERT INTO "sqlite_sequence" VALUES('tasks',1);\n`;

    expect(() =>
      verifyBackupArtifact(
        io({ ...files("/b"), "/b/data.sql": data }),
        "/b",
        artifact({ artifacts: [declares("schema.sql", SCHEMA_SQL), declares("data.sql", data)] }),
      ),
    ).toThrow(/data.sql is not what a data-only artifact must be/);
  });
});
