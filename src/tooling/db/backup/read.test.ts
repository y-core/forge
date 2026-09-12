import { describe, expect, it } from "bun:test";

import { toColumnInfo, toSchemaObjects } from "../sql";
import { argvHas, describeTableReply, fakeDbIo, jsonBatches, jsonRows, projectReadRows } from "../test-support";
import type { DbIo, FakeDbIo, Home } from "../types";
import { SqlReal } from "./artifact";
import { compareTable, describeTable, discoverAppTables, keyCollation, readColumns, readPage, readWholeTable } from "./read";

function capture(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

const HOME: Home = {
  label: "local",
  database: "app-db",
  dir: "/app",
  configPath: "/app/wrangler.jsonc",
  persistTo: "/app/.wrangler/state",
  place: "local",
  env: null,
  synthesized: false,
};

const INVENTORY = [
  { type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" },
  { type: "table", name: "notes", tbl_name: "notes", sql: "CREATE TABLE notes (body TEXT)" },
  { type: "table", name: "d1_migrations", tbl_name: "d1_migrations", sql: "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY)" },
  { type: "table", name: "forge_migrations", tbl_name: "forge_migrations", sql: "CREATE TABLE forge_migrations (name TEXT PRIMARY KEY)" },
  { type: "index", name: "idx_tasks_lane", tbl_name: "tasks", sql: "CREATE INDEX idx_tasks_lane ON tasks (lane)" },
];

const COLUMNS: Readonly<Record<string, Record<string, unknown>[]>> = {
  tasks: [
    { cid: 0, name: "uuid", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
    { cid: 1, name: "lane", type: "TEXT", notnull: 1, dflt_value: "''", pk: 0 },
  ],
  notes: [{ cid: 0, name: "body", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 }],
  d1_migrations: [{ cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1 }],
  forge_migrations: [{ cid: 0, name: "name", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 }],
  auth_users: [
    { cid: 0, name: "id", type: "BLOB", notnull: 1, dflt_value: null, pk: 1 },
    { cid: 1, name: "email", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  ],
  members: [
    { cid: 0, name: "team", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
    { cid: 1, name: "person", type: "TEXT", notnull: 1, dflt_value: null, pk: 2 },
  ],
  aliased: [
    { cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1 },
    { cid: 1, name: "forge:type:id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
  ],
};

function storageClassOf(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof SqlReal) return "real";
  if (Array.isArray(value)) return "blob";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "real";
  return "text";
}

function sortKey(value: unknown): string {
  if (value instanceof SqlReal) return String(value.value);
  return Array.isArray(value)
    ? value
        .map((byte: number) => byte.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    : String(value);
}

/** A fake wrangler that answers the inventory, `pragma_table_info`, and a keyset page of `rows`. */
function fakeDatabase(rows: Readonly<Record<string, Record<string, unknown>[]>> = {}): FakeDbIo {
  const io = fakeDbIo();
  io.rules.push({
    match: (args) => argvHas(args, "execute", "--command"),
    reply: (args) => {
      const statement = args[args.length - 1] ?? "";
      // The batched read `describeTable` makes names both, so it is recognised before either alone.
      const info = /pragma_table_info\('([^']+)'\)/.exec(statement);
      if (info !== null) {
        const table = info[1] ?? "";
        const columns = COLUMNS[table] ?? [];
        if (!statement.includes("sqlite_master")) return jsonRows(columns);
        return describeTableReply(columns, INVENTORY.find((object) => object.name === table)?.sql);
      }
      if (statement.includes("sqlite_master")) return jsonRows(INVENTORY);
      if (statement.includes("IS NULL LIMIT 1")) {
        const all = rows[/FROM "([^"]+)"/.exec(statement)?.[1] ?? ""] ?? [];
        const column = /WHERE "([^"]+)" IS NULL/.exec(statement)?.[1] ?? "";
        const nulls = all.filter((row) => row[column] === null || row[column] === undefined);
        const classes = new Set(all.map((row) => storageClassOf(row[column])));
        return jsonBatches([nulls.slice(0, 1).map(() => ({ present: 1 })), [{ classes: Math.max(classes.size, 1) }]]);
      }
      const from = /FROM "([^"]+)"/.exec(statement);
      const after = /WHERE t\."[^"]+" > '([^']*)'/.exec(statement);
      const afterBlob = /WHERE t\."[^"]+" > X'([0-9a-fA-F]*)'/.exec(statement);
      const limit = Number(/LIMIT (\d+)$/.exec(statement)?.[1] ?? 0);
      const all = rows[from?.[1] ?? ""] ?? [];
      const key = /ORDER BY t\."([^"]+)"/.exec(statement)?.[1] ?? "";
      const afterNumber = /WHERE t\."[^"]+" > (-?\d+(?:\.\d+)?) ORDER/.exec(statement);
      const cursor = afterBlob?.[1]?.toUpperCase() ?? after?.[1];
      const seek =
        afterNumber !== null
          ? all.filter((row) => Number(sortKey(row[key])) > Number(afterNumber[1]))
          : cursor === undefined
            ? all
            : all.filter((row) => sortKey(row[key]) > cursor);
      return jsonRows(projectReadRows(seek.slice(0, limit)));
    },
  });
  return io;
}

/** Tables whose key carries a collation, each with the columns and the DDL `describeTable` reads together. */
const COLLATED: Readonly<Record<string, { sql: string; columns: Record<string, unknown>[] }>> = {
  people: {
    sql: "CREATE TABLE people (handle TEXT PRIMARY KEY COLLATE NOCASE, name TEXT)",
    columns: [
      { cid: 0, name: "handle", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
      { cid: 1, name: "name", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    ],
  },
  badges: {
    sql: 'CREATE TABLE badges (tag TEXT NOT NULL, PRIMARY KEY ("tag" COLLATE NOCASE))',
    columns: [{ cid: 0, name: "tag", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 }],
  },
  labels: {
    sql: "CREATE TABLE labels (tag TEXT NOT NULL, PRIMARY KEY (tag COLLATE NOCASE)) WITHOUT ROWID",
    columns: [{ cid: 0, name: "tag", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 }],
  },
  codes: {
    sql: "CREATE TABLE codes (code TEXT PRIMARY KEY COLLATE BINARY)",
    columns: [{ cid: 0, name: "code", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 }],
  },
  mail: {
    sql: "CREATE TABLE mail (id TEXT PRIMARY KEY, address TEXT COLLATE NOCASE)",
    columns: [
      { cid: 0, name: "id", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
      { cid: 1, name: "address", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    ],
  },
};

function collationDatabase(): DbIo {
  const io = fakeDbIo();
  io.rules.push({
    match: (args) => argvHas(args, "execute", "--command"),
    reply: (args) => {
      const table = /pragma_table_info\('([^']+)'\)/.exec(args[args.length - 1] ?? "")?.[1] ?? "";
      const found = COLLATED[table];
      return describeTableReply(found?.columns ?? [], found?.sql);
    },
  });
  return io;
}

describe("toSchemaObjects() and toColumnInfo()", () => {
  it("maps wrangler's snake-case rows onto the shapes the comparison reads", () => {
    expect(toSchemaObjects([{ type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT)" }])).toEqual([
      { type: "table", name: "tasks", tblName: "tasks", sql: "CREATE TABLE tasks (uuid TEXT)" },
    ]);
    expect(toColumnInfo([{ cid: 1, name: "lane", type: "TEXT", notnull: 1, dflt_value: "''", pk: 0 }])).toEqual([
      { cid: 1, name: "lane", type: "TEXT", notnull: 1, dfltValue: "''", pk: 0 },
    ]);
  });

  it("reads an absent sql and an absent default as null, not as the string", () => {
    expect(toSchemaObjects([{ type: "table", name: "t", tbl_name: "t" }])[0]?.sql).toBeNull();
    expect(toColumnInfo([{ cid: 0, name: "c", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 }])[0]?.dfltValue).toBeNull();
  });
});

describe("readColumns()", () => {
  it("reads one table's columns in declaration order", () => {
    expect(readColumns(fakeDatabase(), HOME, "tasks").map((column) => column.name)).toEqual(["uuid", "lane"]);
  });
});

describe("describeTable()", () => {
  it("orders by the declared primary key", () => {
    expect(describeTable(fakeDatabase(), HOME, "tasks")).toEqual({ name: "tasks", key: "uuid", columns: ["uuid", "lane"], pageRows: 256 });
  });

  it("falls back to rowid for a table that declares no primary key", () => {
    expect(describeTable(fakeDatabase(), HOME, "notes")).toEqual({ name: "notes", key: "rowid", columns: ["body"], pageRows: 256 });
  });

  it("refuses a composite primary key, which a keyset read cannot order by", () => {
    expect((capture(() => describeTable(fakeDatabase(), HOME, "members")) as Error).message).toBe(
      "members has a composite primary key (team, person) — a keyset read orders by one column, so this table cannot be backed up",
    );
  });

  it("refuses a key holding NULL, which a keyset read can never seek past", () => {
    const io = fakeDatabase({
      tasks: [
        { uuid: "t1", lane: "todo" },
        { uuid: null, lane: "doing" },
      ],
    });

    expect((capture(() => describeTable(io, HOME, "tasks")) as Error).message).toBe(
      "tasks.uuid holds NULL in at least one row — a keyset read seeks past the key it last read and cannot seek past a NULL, so this table cannot be backed up",
    );
  });

  it("refuses a key spanning two storage classes, whose seek and whose order disagree", () => {
    const io = fakeDatabase({
      tasks: [
        { uuid: "t1", lane: "todo" },
        { uuid: 2, lane: "doing" },
      ],
    });

    expect((capture(() => describeTable(io, HOME, "tasks")) as Error).message).toBe(
      "tasks.uuid holds more than one storage class — a keyset read orders by one column and its seek and its order disagree across classes, so this table cannot be backed up",
    );
  });

  it("refuses a column named in the space the read projects each storage class under", () => {
    const io = fakeDatabase({ aliased: [{ id: 1, "forge:type:id": "text" }] });

    expect((capture(() => describeTable(io, HOME, "aliased")) as Error).message).toBe(
      "aliased declares column(s) [forge:type:id] beginning forge:type: — a read projects each column's storage class under that name, so this table cannot be backed up",
    );
  });

  it("reads a key of one class and no NULL without refusing", () => {
    const io = fakeDatabase({
      tasks: [
        { uuid: "t1", lane: "todo" },
        { uuid: "t2", lane: "doing" },
      ],
    });

    expect(describeTable(io, HOME, "tasks")).toEqual({ name: "tasks", key: "uuid", columns: ["uuid", "lane"], pageRows: 256 });
  });

  it("orders a key that collates NOCASE by rowid, which is ordered the way the read compares", () => {
    expect(describeTable(collationDatabase(), HOME, "people")).toEqual({
      name: "people",
      key: "rowid",
      columns: ["handle", "name"],
      pageRows: 256,
    });
  });

  it("reads a collation declared on the PRIMARY KEY constraint, not only on the column", () => {
    expect(describeTable(collationDatabase(), HOME, "badges")).toEqual({ name: "badges", key: "rowid", columns: ["tag"], pageRows: 256 });
  });

  it("orders by the key itself when the declared collation is BINARY, which is what the read compares", () => {
    expect(describeTable(collationDatabase(), HOME, "codes")).toEqual({ name: "codes", key: "code", columns: ["code"], pageRows: 256 });
  });

  it("refuses a WITHOUT ROWID table whose key collates otherwise, naming the column and the collation", () => {
    expect((capture(() => describeTable(collationDatabase(), HOME, "labels")) as Error).message).toBe(
      "labels.tag collates NOCASE and labels is WITHOUT ROWID — a keyset read orders by BINARY and this table has no other column to order by, so it cannot be backed up",
    );
  });

  it("leaves a collation on a column that is not the key alone", () => {
    expect(describeTable(collationDatabase(), HOME, "mail")).toEqual({ name: "mail", key: "id", columns: ["id", "address"], pageRows: 256 });
  });
});

describe("keyCollation()", () => {
  it("is null for DDL it cannot split, so an unparsable table is read rather than refused", () => {
    expect(keyCollation("CREATE TABLE t AS SELECT 1", "id")).toBeNull();
  });
});

describe("discoverAppTables()", () => {
  it("finds the app's own tables and skips the managed, system and non-table objects", () => {
    expect(discoverAppTables(fakeDatabase(), HOME, "d1_migrations")).toEqual([
      { name: "tasks", key: "uuid", columns: ["uuid", "lane"], pageRows: 256 },
      { name: "notes", key: "rowid", columns: ["body"], pageRows: 256 },
    ]);
  });

  it("treats the migrations table it is told about as managed, and the default one as the app's", () => {
    expect(discoverAppTables(fakeDatabase(), HOME, "forge_migrations").map((table) => table.name)).toEqual(["tasks", "notes", "d1_migrations"]);
  });
});

const TASKS = { name: "tasks", key: "uuid", columns: ["uuid", "lane"], pageRows: 256 };

function taskRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({ uuid: `t${String(index).padStart(4, "0")}`, lane: "todo" }));
}

describe("readPage()", () => {
  it("returns the canonical rows, the raw rows and the cursor the next page seeks past", () => {
    const page = readPage(fakeDatabase({ tasks: taskRows(3) }), HOME, TASKS, ["uuid", "lane"], null);

    expect(page.raw).toEqual([
      { uuid: "t0000", lane: "todo" },
      { uuid: "t0001", lane: "todo" },
      { uuid: "t0002", lane: "todo" },
    ]);
    expect(page.rows.map((row) => row.key)).toEqual(["S:5:t0000", "S:5:t0001", "S:5:t0002"]);
    expect(page.cursor).toBe("t0002");
    expect(page.exhausted).toBe(true);
  });

  it("reports a full page as not exhausted, and seeks past the cursor on the next one", () => {
    const io = fakeDatabase({ tasks: taskRows(300) });
    const first = readPage(io, HOME, TASKS, ["uuid", "lane"], null);
    const second = readPage(io, HOME, TASKS, ["uuid", "lane"], first.cursor);

    expect(first.raw.length).toBe(256);
    expect(first.exhausted).toBe(false);
    expect(second.raw.length).toBe(44);
    expect(second.exhausted).toBe(true);
    expect(second.raw[0]).toEqual({ uuid: "t0256", lane: "todo" });
  });

  it("returns a null cursor for an empty page", () => {
    expect(readPage(fakeDatabase(), HOME, TASKS, ["uuid", "lane"], null).cursor).toBeNull();
  });

  it("seeks past a REAL key as the number it is, not as a blob", () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ t: new SqlReal(index), v: "x" }));
    const table = { name: "samples", key: "t", columns: ["t", "v"], pageRows: 256 };
    const io = fakeDatabase({ samples: rows });

    const first = readPage(io, HOME, table, ["t", "v"], null);
    expect(first.cursor).toBe(255);
    expect(first.raw[1]).toEqual({ t: new SqlReal(1), v: "x" });
    expect(first.rows[1]?.key).toBe("R:1");

    const second = readPage(io, HOME, table, ["t", "v"], first.cursor);
    const statement = io.calls.at(-1)?.at(-1);
    expect(statement).toBe(
      `SELECT CASE WHEN typeof("t")='blob' THEN hex("t") ELSE "t" END AS "t", typeof("t") AS "forge:type:t", CASE WHEN typeof("v")='blob' THEN hex("v") ELSE "v" END AS "v", typeof("v") AS "forge:type:v" FROM "samples" AS t WHERE t."t" > 255 ORDER BY t."t" LIMIT 256`,
    );
    expect(second.raw.length).toBe(44);
  });

  it("advances the cursor of a BLOB key, which a read over two pages cannot terminate without", () => {
    const users = Array.from({ length: 300 }, (_, index) => ({ id: [1, 2, index >> 8, index & 255], email: `p${index}@example.com` }));
    const table = { name: "auth_users", key: "id", columns: ["id", "email"], pageRows: 256 };
    const io = fakeDatabase({ auth_users: users });

    const first = readPage(io, HOME, table, ["id", "email"], null);
    expect(first.exhausted).toBe(false);
    expect(first.cursor).toEqual([1, 2, 0, 255]);
    expect(first.raw[0]).toEqual({ id: [1, 2, 0, 0], email: "p0@example.com" });
    expect(first.rows[0]?.key).toBe("B:01020000");

    const second = readPage(io, HOME, table, ["id", "email"], first.cursor);
    expect(second.raw.length).toBe(44);
    expect(second.exhausted).toBe(true);
    expect(second.raw[0]).toEqual({ id: [1, 2, 1, 0], email: "p256@example.com" });

    expect(readWholeTable(io, HOME, table).rows.length).toBe(300);
  });
});

describe("readWholeTable()", () => {
  it("reads every row across as many pages as it takes", () => {
    const read = readWholeTable(fakeDatabase({ tasks: taskRows(300) }), HOME, TASKS);

    expect(read.columns).toEqual(["uuid", "lane"]);
    expect(read.rows.length).toBe(300);
    expect(read.raw[299]).toEqual({ uuid: "t0299", lane: "todo" });
  });

  it("refuses a full page whose key did not advance, rather than re-reading it for ever", () => {
    // A read that never advances is unbounded in memory as well as in time, so it must end in a
    // refusal; this fake answers every seek with the same page, as a repeated key would.
    const io = fakeDbIo();
    const page = projectReadRows(Array.from({ length: 256 }, () => ({ uuid: "same", lane: "todo" })));
    io.rules.push({
      match: (args) => argvHas(args, "execute", "--command"),
      reply: (args) => (/pragma_table_info/.test(args.at(-1) ?? "") ? jsonRows(COLUMNS.tasks ?? []) : jsonRows(page)),
    });

    expect((capture(() => readWholeTable(io, HOME, TASKS)) as Error).message).toBe(
      'tasks read a full page and its key uuid did not advance past "same" — a keyset read cannot page past a repeated or NULL key, so this table cannot be backed up',
    );
  });

  it("adds the key column to the projection when it is a rowid the table does not declare", () => {
    const io = fakeDatabase({ notes: [{ rowid: 1, body: "a" }] });
    const read = readWholeTable(io, HOME, { name: "notes", key: "rowid", columns: ["body"], pageRows: 256 });

    expect(read.columns).toEqual(["rowid", "body"]);
    expect(read.rows[0]?.key).toBe("I:1");
  });
});

describe("compareTable()", () => {
  it("finds nothing when the target holds the rows the source was read from", () => {
    const io = fakeDatabase({ tasks: taskRows(300) });
    const comparison = compareTable(io, readWholeTable(io, HOME, TASKS), HOME);

    expect(comparison.divergent).toBe(0);
    expect(comparison.sourceRows).toBe(300);
    expect(comparison.targetRows).toBe(300);
  });

  it("reports the row the target is missing", () => {
    const source = readWholeTable(fakeDatabase({ tasks: taskRows(3) }), HOME, TASKS);
    const target = fakeDatabase({ tasks: taskRows(3).filter((row) => row.uuid !== "t0001") });
    const comparison = compareTable(target, source, HOME);

    expect(comparison.divergences).toEqual([{ kind: "only-in-source", key: "S:5:t0001" }]);
    expect(comparison.divergent).toBe(1);
  });

  it("names the column a restored row moved in", () => {
    const source = readWholeTable(fakeDatabase({ tasks: [{ uuid: "t0", lane: "todo" }] }), HOME, TASKS);
    const comparison = compareTable(fakeDatabase({ tasks: [{ uuid: "t0", lane: "doing" }] }), source, HOME);

    expect(comparison.divergences).toEqual([{ kind: "value", key: "S:2:t0", column: "lane", source: "S:4:todo", target: "S:5:doing" }]);
  });
});
