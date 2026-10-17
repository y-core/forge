import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { fakeDbIo, schemaModelRows } from "../db.fixture";
import { appHome } from "../home";
import { schemaModelSelects } from "../schema/introspect";
import { toSchemaObjects } from "../sql";
import type { DbConfig, DbRunContext, FakeDbIo, Home, SchemaObject, Seed } from "../types";
import { isRowConstraintRefusal, isSchemaWritingProgram, refuseSchemaChangingSeeds, seedName } from "./effect";

const COPY = "/app/.forge/scratch/compose/seed";
const COPY_LABEL = "scratch:compose-seed";

interface CopySchema {
  inventory: Record<string, unknown>[];
  columns: Record<string, unknown>[];
}

function context(): { run: DbRunContext; io: FakeDbIo } {
  const io = fakeDbIo();
  const config: DbConfig = {
    root: "/app",
    configPath: "/app/wrangler.jsonc",
    config: {
      name: "app",
      compatibility_date: "2026-01-01",
      d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" }],
    } as WranglerConfig,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
    target: { place: "local", database: null },
  };
  const run: DbRunContext = { config, home: appHome(config), io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} };
  return { run, io };
}

function seedOf(name: string, sql: string): Seed {
  return { source: "seeds", name, path: `/app/seeds/${name}.sql`, sha256: "a".repeat(64), sql, places: null };
}

const onCopy = (home: Home) => home.label === COPY_LABEL;

const op = (opcode: string, p2 = 0) => ({ opcode, p1: 0, p2 });
const DATA_PROGRAM = [op("Init", 7), op("OpenWrite", 2), op("Insert"), op("Halt")];
const UNIQUE_INDEX_PROGRAM = [op("Init", 36), op("CreateBtree", 1), op("IdxInsert"), op("SetCookie", 1), op("ParseSchema"), op("Halt")];
const ADD_COLUMN_PROGRAM = [op("Init", 69), op("SetCookie", 2), op("SetCookie", 1), op("ParseSchema"), op("Halt")];

/** Answers the copy's model reads from `schema`, its `EXPLAIN` of a statement from `explain`, and hands every other statement on the copy to `react`. */
function wireCopy(
  io: FakeDbIo,
  schema: CopySchema,
  react: (statement: string, schema: CopySchema) => void = () => {},
  explain: (statement: string) => Record<string, unknown>[] = () => DATA_PROGRAM,
): void {
  const selects: string[] = Object.values(schemaModelSelects());
  io.d1Rules.push({
    match: (_statement, home) => onCopy(home),
    reply: (statement) => {
      if (selects.includes(statement)) return schemaModelRows(statement, schema);
      if (statement.startsWith("EXPLAIN ")) return explain(statement.slice("EXPLAIN ".length));
      react(statement, schema);
      return [];
    },
  });
}

const statementsOnCopy = (io: FakeDbIo) =>
  io.d1Calls.filter((call) => call.home === COPY_LABEL && call.source === null && call.statements.length === 1).map((call) => call.statements[0]);

const TABLE_T = { type: "table", name: "t", tbl_name: "t", sql: "CREATE TABLE t (a, b)" };
const COLUMNS_T = [
  { tbl: "t", cid: 0, name: "a", type: "", notnull: 0, dflt_value: null, pk: 0, hidden: 0 },
  { tbl: "t", cid: 1, name: "b", type: "", notnull: 0, dflt_value: null, pk: 0, hidden: 0 },
];
const VIEW_V = { type: "view", name: "v", tbl_name: "v", sql: "CREATE VIEW v AS SELECT a FROM t" };
const INVENTORY: SchemaObject[] = toSchemaObjects([TABLE_T, VIEW_V]);

const refusal = (detail: string) => new Error(`D1_ERROR: ${detail}`);

describe("refuseSchemaChangingSeeds()", () => {
  it("passes a seed that leaves the schema as it was, running each statement as its own batch on the seed copy, in order", async () => {
    const { run, io } = context();
    wireCopy(io, { inventory: [TABLE_T, VIEW_V], columns: COLUMNS_T });
    const seed = seedOf("001_rows", "INSERT INTO t (a) VALUES (1);\nUPDATE t SET b = 2 WHERE a = 1;\nDELETE FROM t WHERE a = 3;");

    await refuseSchemaChangingSeeds(run, [seed], new Map(), INVENTORY);

    expect(statementsOnCopy(io)).toEqual(["INSERT INTO t (a) VALUES (1)", "UPDATE t SET b = 2 WHERE a = 1", "DELETE FROM t WHERE a = 3"]);
    expect(io.d1Calls.every((call) => call.persistTo.startsWith(`${COPY}/`))).toBe(true);
    expect(io.d1Calls.some((call) => call.home === run.home.label)).toBe(false);
  });

  it("cuts each seed's expanded text through the copy's own split, once per seed", async () => {
    const { run, io } = context();
    wireCopy(io, { inventory: [], columns: [] });
    const split: [string, string][] = [];
    const splitD1 = io.splitD1.bind(io);
    io.splitD1 = (home, sql) => {
      split.push([home.label, sql]);
      return splitD1(home, sql);
    };
    const first = seedOf("001_users", "INSERT INTO users (email) VALUES ('${ADMIN}');");
    const second = seedOf("002_posts", "INSERT INTO posts (title) VALUES ('hello');");

    await refuseSchemaChangingSeeds(run, [first, second], new Map([[first, "INSERT INTO users (email) VALUES ('a@example.com');"]]), []);

    expect(split).toEqual([
      [COPY_LABEL, "INSERT INTO users (email) VALUES ('a@example.com');"],
      [COPY_LABEL, "INSERT INTO posts (title) VALUES ('hello');"],
    ]);
    expect(statementsOnCopy(io)).toEqual(["INSERT INTO users (email) VALUES ('a@example.com')", "INSERT INTO posts (title) VALUES ('hello')"]);
  });

  const changes: [string, string, (schema: CopySchema) => void, string][] = [
    [
      "creates an index",
      "CREATE INDEX t_a ON t (a);",
      (schema) => schema.inventory.push({ type: "index", name: "t_a", tbl_name: "t", sql: "CREATE INDEX t_a ON t (a)" }),
      "index t_a: in the schema after it, not in the schema before it",
    ],
    [
      "drops a view",
      "DROP VIEW v;",
      (schema) => (schema.inventory = schema.inventory.filter((row) => row.name !== "v")),
      "view v: in the schema before it, not in the schema after it",
    ],
    [
      "drops a column",
      "ALTER TABLE t DROP COLUMN b;",
      (schema) => {
        schema.inventory = schema.inventory.map((row) => (row.name === "t" ? { ...row, sql: "CREATE TABLE t (a)" } : row));
        schema.columns = schema.columns.filter((row) => row.name !== "b");
      },
      "table t: differs between the schema before it and the schema after it",
    ],
  ];
  for (const [what, sql, effect, line] of changes) {
    it(`refuses a seed that ${what}, naming the seed and the change, and touching nothing but the copy`, async () => {
      const { run, io } = context();
      wireCopy(io, { inventory: [TABLE_T, VIEW_V], columns: COLUMNS_T }, (statement, schema) => {
        if (`${statement};` === sql) effect(schema);
      });

      const refused = refuseSchemaChangingSeeds(run, [seedOf("002_change", `INSERT INTO t (a) VALUES (1);\n${sql}`)], new Map(), INVENTORY);

      await expect(refused).rejects.toThrow(
        `seeds:002_change changes the schema of app-db (local), and only a composed migration may — no seed was applied:\n  ${line}\n`,
      );
      expect(io.d1Calls.some((call) => call.home === run.home.label)).toBe(false);
    });
  }

  const ROW_CONSTRAINTS = [
    "FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)",
    "UNIQUE constraint failed: child.code: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)",
    "NOT NULL constraint failed: child.note: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)",
    "CHECK constraint failed: note <> '': SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)",
  ];
  for (const detail of ROW_CONSTRAINTS) {
    it(`passes over a statement the copy refuses with ${/SQLITE_CONSTRAINT_\w+/.exec(detail)?.[0]}, and runs the next`, async () => {
      const { run, io } = context();
      wireCopy(io, { inventory: [TABLE_T], columns: COLUMNS_T }, (statement) => {
        if (statement.startsWith("INSERT INTO t (a) VALUES (1)")) throw refusal(detail);
      });

      await refuseSchemaChangingSeeds(run, [seedOf("001_rows", "INSERT INTO t (a) VALUES (1);\nINSERT INTO t (a) VALUES (2);")], new Map(), []);

      expect(statementsOnCopy(io)).toEqual([
        "INSERT INTO t (a) VALUES (1)",
        "EXPLAIN INSERT INTO t (a) VALUES (1)",
        "INSERT INTO t (a) VALUES (2)",
      ]);
    });
  }

  const schemaWrites: [string, string, string, Record<string, unknown>[]][] = [
    [
      "a unique index over duplicate rows",
      "INSERT INTO t (a) VALUES (1),(1);\nDELETE FROM t WHERE EXISTS (SELECT 1 FROM p);\nCREATE UNIQUE INDEX t_a ON t (a);\nINSERT INTO t (a) VALUES (2);",
      ROW_CONSTRAINTS[1] ?? "",
      UNIQUE_INDEX_PROGRAM,
    ],
    [
      "a CHECK column over failing rows",
      "INSERT INTO t (a) VALUES (1);\nALTER TABLE t ADD COLUMN c INTEGER DEFAULT 0 CHECK (c > 0);\nINSERT INTO t (a) VALUES (2);",
      ROW_CONSTRAINTS[3] ?? "",
      ADD_COLUMN_PROGRAM,
    ],
  ];
  for (const [what, sql, detail, program] of schemaWrites) {
    it(`refuses a seed writing ${what} that a row constraint stops on the copy, naming it and running nothing after it`, async () => {
      const { run, io } = context();
      const schemaStatement = sql.split(";\n").find((statement) => /^(CREATE|ALTER)/.test(statement)) ?? "";
      wireCopy(
        io,
        { inventory: [TABLE_T], columns: COLUMNS_T },
        (statement) => {
          if (statement === schemaStatement) throw refusal(detail);
        },
        (statement) => (statement === schemaStatement ? program : DATA_PROGRAM),
      );

      const refused = refuseSchemaChangingSeeds(run, [seedOf("005_unchecked", sql)], new Map(), INVENTORY);

      await expect(refused).rejects.toThrow(
        `seeds:005_unchecked writes the schema of app-db (local) at \`${schemaStatement}\`, which a row constraint stopped on the copy but need not stop on the target, and only a composed migration may — no seed was applied:\nD1_ERROR: ${detail}\n`,
      );
      expect(statementsOnCopy(io).slice(-2)).toEqual([schemaStatement, `EXPLAIN ${schemaStatement}`]);
      expect(io.d1Calls.some((call) => call.home === run.home.label)).toBe(false);
    });
  }

  const unreadable: [string, () => Record<string, unknown>[]][] = [
    [
      "its EXPLAIN fails",
      () => {
        throw refusal("not authorized: SQLITE_AUTH");
      },
    ],
    ["its EXPLAIN answers no program", () => []],
  ];
  for (const [what, explain] of unreadable) {
    it(`refuses a seed whose statement a row constraint stops when ${what}, naming the statement`, async () => {
      const { run, io } = context();
      wireCopy(
        io,
        { inventory: [TABLE_T], columns: COLUMNS_T },
        (statement) => {
          if (statement === "INSERT INTO t (a) VALUES (1)") throw refusal(ROW_CONSTRAINTS[0] ?? "");
        },
        explain,
      );

      await expect(
        refuseSchemaChangingSeeds(run, [seedOf("006_opaque", "INSERT INTO t (a) VALUES (1);\nINSERT INTO t (a) VALUES (2);")], new Map(), []),
      ).rejects.toThrow(
        `seeds:006_opaque fails a row constraint on a copy of app-db (local)'s schema at \`INSERT INTO t (a) VALUES (1)\`, and its program could not be read to show it writes no schema, so no seed was applied:\nD1_ERROR: ${ROW_CONSTRAINTS[0]}`,
      );
      expect(statementsOnCopy(io)).not.toContain("INSERT INTO t (a) VALUES (2)");
    });
  }

  it("still refuses a drop that follows a statement a row constraint stopped", async () => {
    const { run, io } = context();
    wireCopy(io, { inventory: [TABLE_T, VIEW_V], columns: COLUMNS_T }, (statement, schema) => {
      if (statement.startsWith("INSERT")) throw refusal(ROW_CONSTRAINTS[0] ?? "");
      if (statement === "DROP VIEW v") schema.inventory = schema.inventory.filter((row) => row.name !== "v");
    });

    await expect(
      refuseSchemaChangingSeeds(run, [seedOf("003_hidden", "INSERT INTO t (a) VALUES (9);\nDROP VIEW v;")], new Map(), INVENTORY),
    ).rejects.toThrow("seeds:003_hidden changes the schema of app-db (local)");
  });

  const otherErrors = [
    'near "INSRT": syntax error: SQLITE_ERROR',
    "no such table: x: SQLITE_ERROR",
    "UNIQUE constraint failed: t.a: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)",
  ];
  for (const detail of otherErrors) {
    it(`refuses the seed on \`${detail.slice(0, 40)}\`, naming the statement and running nothing after it`, async () => {
      const { run, io } = context();
      wireCopy(io, { inventory: [], columns: [] }, (statement) => {
        if (statement.startsWith("INSRT")) throw refusal(detail);
      });

      await expect(
        refuseSchemaChangingSeeds(run, [seedOf("004_bad", "INSRT INTO t (a) VALUES (1);\nINSERT INTO t (a) VALUES (2);")], new Map(), []),
      ).rejects.toThrow(
        `seeds:004_bad fails on a copy of app-db (local)'s schema at \`INSRT INTO t (a) VALUES (1)\`, so no seed was applied — fix the statement:\nD1_ERROR: ${detail}`,
      );
      expect(statementsOnCopy(io)).toEqual(["INSRT INTO t (a) VALUES (1)"]);
    });
  }

  it("builds no copy when there is no seed to judge", async () => {
    const { run, io } = context();

    await refuseSchemaChangingSeeds(run, [], new Map(), INVENTORY);

    expect(io.d1Calls).toEqual([]);
    expect([...io.files.keys()]).toEqual([]);
  });
});

describe("seedName()", () => {
  it("names a seed by its directory, then its name", () => {
    expect(seedName(seedOf("001_users", ""))).toBe("seeds:001_users");
  });
});

describe("isSchemaWritingProgram()", () => {
  const cases: [string, Record<string, unknown>[], boolean][] = [
    ...["ParseSchema", "CreateBtree", "Destroy", "DropTable", "DropIndex", "DropTrigger"].map(
      (opcode): [string, Record<string, unknown>[], boolean] => [opcode, [op("Init"), op(opcode), op("Halt")], true],
    ),
    ["SetCookie on the schema cookie", [op("Init"), op("SetCookie", 1), op("Halt")], true],
    ["SetCookie on the user version", [op("Init"), op("SetCookie", 6), op("Halt")], false],
    ["a row-writing program", DATA_PROGRAM, false],
    ["no program", [], false],
  ];
  for (const [what, program, expected] of cases) {
    it(`answers ${expected} for ${what}`, () => {
      expect(isSchemaWritingProgram(program)).toBe(expected);
    });
  }
});

describe("isRowConstraintRefusal()", () => {
  const cases: [string, unknown, boolean][] = [
    ["FOREIGNKEY", refusal("FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)"), true],
    ["UNIQUE", refusal("UNIQUE constraint failed: c.code: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)"), true],
    ["NOTNULL", refusal("NOT NULL constraint failed: c.note: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)"), true],
    ["CHECK", refusal("CHECK constraint failed: note: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)"), true],
    ["PRIMARYKEY", refusal("UNIQUE constraint failed: c.id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)"), false],
    ["TRIGGER", refusal("stopped: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)"), false],
    ["a syntax error", refusal('near "INSRT": syntax error: SQLITE_ERROR'), false],
    ["a message with no extended code", refusal("FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY"), false],
    ["a non-Error", "(extended: SQLITE_CONSTRAINT_FOREIGNKEY)", false],
  ];
  for (const [what, error, expected] of cases) {
    it(`answers ${expected} for ${what}`, () => {
      expect(isRowConstraintRefusal(error)).toBe(expected);
    });
  }
});
