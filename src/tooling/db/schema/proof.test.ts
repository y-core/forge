import { describe, expect, it } from "bun:test";
import { basename } from "node:path";

import type { WranglerConfig } from "../../cf/types";
import { CliError } from "../../cli/errors";
import { PLAIN } from "../../term/color";
import { fakeDbIo, schemaModelRows } from "../db.fixture";
import { appHome } from "../home";
import type { DbConfig, DbRunContext, FakeDbIo } from "../types";
import { assembleSchemaModel } from "./introspect";
import { proveComposed, seedRows } from "./proof";
import type { DataDependentStep, SchemaColumn, SchemaForeignKey, SchemaInputs, SchemaModel, SchemaRename, SchemaTable } from "./types";

const column = (name: string, type: string, over: Partial<SchemaColumn> = {}): SchemaColumn => ({
  name,
  type,
  notnull: false,
  defaultExpr: null,
  pk: 0,
  hidden: 0,
  definition: `${name} ${type}`.toUpperCase(),
  definitionSource: `${name} ${type}`,
  ...over,
});
const key = (name: string, type = "INTEGER") => column(name, type, { pk: 1 });
const required = (name: string, type = "INTEGER") => column(name, type, { notnull: true });
const references = (table: string, from: string[], to: (string | null)[]): SchemaForeignKey => ({
  table,
  from,
  to,
  onUpdate: "NO ACTION",
  onDelete: "NO ACTION",
});
const table = (name: string, columns: SchemaColumn[], foreignKeys: SchemaForeignKey[] = []): SchemaTable => ({
  name,
  columns,
  constraints: [],
  strict: false,
  withoutRowid: false,
  foreignKeys,
  sql: `CREATE TABLE ${name} (${columns.map((c) => c.definitionSource).join(", ")})`,
});
const model = (tables: SchemaTable[]): SchemaModel => ({ tables, indexes: [], triggers: [], views: [] });

const seededTables = (baseline: SchemaModel, steps: DataDependentStep[] = [], renames: SchemaRename[] = []) =>
  seedRows(baseline, renames, steps).tables;
const valuesOf = (statements: readonly string[], name: string) => {
  const insert = statements
    .map((statement) => /^INSERT INTO "([^"]+)" \(([^)]*)\) VALUES \((.*)\);$/.exec(statement))
    .find((match) => match?.[1] === name);
  const columns = (insert?.[2] ?? "").split(",").map((quoted) => quoted.slice(1, -1));
  const literals = (insert?.[3] ?? "").split(",");
  return Object.fromEntries(insert === undefined ? [] : columns.map((inserted, index) => [inserted, literals[index]]));
};

describe("seedRows()", () => {
  it("seeds one constant per affinity, by SQLite's affinity rules, in the form quote() reads it back", () => {
    const t = table("t", [
      key("id"),
      column("i", "BIGINT"),
      column("r", "REAL"),
      column("x", "TEXT"),
      column("b", "BLOB"),
      column("n", "NUMERIC"),
      column("v", "VARCHAR(10)"),
      column("d", "DOUBLE PRECISION"),
      column("dec", "DECIMAL(10,2)"),
      column("fp", "FLOATING POINT"),
      column("untyped", ""),
    ]);

    expect(seedRows(model([t]), [], [])).toEqual({
      statements: [
        `INSERT INTO "t" ("id","i","r","x","b","n","v","d","dec","fp","untyped") VALUES (1,1,1.0,'forge-seed',X'00',1,'forge-seed',1.0,1,1,X'00');`,
      ],
      tables: ["t"],
    });
  });

  it("leaves out generated columns, VIRTUAL and STORED", () => {
    const t = table("t", [key("id"), column("a", "TEXT"), column("v", "TEXT", { hidden: 2 }), column("s", "TEXT", { hidden: 3 })]);

    expect(Object.keys(valuesOf(seedRows(model([t]), [], []).statements, "t"))).toEqual(["id", "a"]);
  });

  it("leaves out a plain column with a non-NULL DEFAULT, and keeps one whose DEFAULT is NULL", () => {
    const t = table("t", [
      key("id"),
      column("plain", "TEXT"),
      column("defaulted", "TEXT", { defaultExpr: "'x'" }),
      column("nulled", "TEXT", { defaultExpr: "null" }),
    ]);

    expect(Object.keys(valuesOf(seedRows(model([t]), [], []).statements, "t"))).toEqual(["id", "plain", "nulled"]);
  });

  it("keeps a defaulted key, a defaulted FK column and a defaulted column a FK points at", () => {
    const parent = table("parent", [key("id"), column("code", "TEXT", { defaultExpr: "'p'" })]);
    const child = table(
      "child",
      [key("id", "INTEGER"), column("parent_code", "TEXT", { defaultExpr: "'p'" })],
      [references("parent", ["parent_code"], ["code"])],
    );
    const keyed = table("keyed", [column("k", "TEXT", { pk: 1, defaultExpr: "'k'" })]);

    const { statements } = seedRows(model([child, keyed, parent]), [], []);

    expect([valuesOf(statements, "parent"), valuesOf(statements, "child"), valuesOf(statements, "keyed")]).toEqual([
      { id: "1", code: "'forge-seed'" },
      { id: "1", parent_code: "'forge-seed'" },
      { k: "'forge-seed'" },
    ]);
  });

  it("inserts a table with nothing to seed as DEFAULT VALUES", () => {
    const t = table("t", [column("a", "TEXT", { defaultExpr: "'x'" }), column("g", "TEXT", { hidden: 2 })]);

    expect(seedRows(model([t]), [], [])).toEqual({ statements: ['INSERT INTO "t" DEFAULT VALUES;'], tables: ["t"] });
  });

  it("orders the inserts parent first, whatever order the baseline lists them in", () => {
    const grandchild = table("a_grandchild", [key("id"), column("child_id", "INTEGER")], [references("b_child", ["child_id"], ["id"])]);
    const child = table("b_child", [key("id"), column("parent_id", "INTEGER")], [references("c_parent", ["parent_id"], ["id"])]);
    const parent = table("c_parent", [key("id")]);

    expect(seedRows(model([grandchild, child, parent]), [], []).statements).toEqual([
      'INSERT INTO "c_parent" ("id") VALUES (1);',
      'INSERT INTO "b_child" ("id","parent_id") VALUES (1,1);',
      'INSERT INTO "a_grandchild" ("id","child_id") VALUES (1,1);',
    ]);
  });

  it("copies the parent's value into a single-column FK that names no column, the parent's key", () => {
    const parent = table("parent", [key("code", "TEXT")]);
    const child = table("child", [key("id"), column("parent_code", "TEXT")], [references("parent", ["parent_code"], [null])]);

    expect(valuesOf(seedRows(model([parent, child]), [], []).statements, "child")).toEqual({ id: "1", parent_code: "'forge-seed'" });
  });

  it("copies every column of a composite FK, by key order where the reference names none", () => {
    const parent = table("parent", [column("b", "TEXT", { pk: 2 }), column("a", "INTEGER", { pk: 1 })]);
    const child = table("child", [key("id"), column("pa", "INTEGER"), column("pb", "TEXT")], [references("parent", ["pa", "pb"], [null, null])]);
    const named = table("named", [key("id"), column("nb", "TEXT"), column("na", "INTEGER")], [references("parent", ["nb", "na"], ["b", "a"])]);

    const { statements } = seedRows(model([parent, child, named]), [], []);

    expect([valuesOf(statements, "child"), valuesOf(statements, "named")]).toEqual([
      { id: "1", pa: "1", pb: "'forge-seed'" },
      { id: "1", nb: "'forge-seed'", na: "1" },
    ]);
  });

  describe("converts a copied FK value to the storage form of the child column's affinity", () => {
    const cases: { parent: string; child: string; literal: string }[] = [
      { parent: "REAL", child: "TEXT", literal: "'1.0'" },
      { parent: "INTEGER", child: "TEXT", literal: "'1'" },
      { parent: "REAL", child: "INTEGER", literal: "1" },
      { parent: "REAL", child: "NUMERIC", literal: "1" },
      { parent: "INTEGER", child: "REAL", literal: "1.0" },
      { parent: "TEXT", child: "INTEGER", literal: "'forge-seed'" },
    ];

    for (const { parent: parentType, child: childType, literal } of cases) {
      it(`${parentType} into ${childType} reads back ${literal}`, () => {
        const parent = table("parent", [key("id"), column("k", parentType)]);
        const child = table("child", [key("id"), column("pk", childType)], [references("parent", ["pk"], ["k"])]);

        expect(valuesOf(seedRows(model([parent, child]), [], []).statements, "child").pk).toBe(literal);
      });
    }
  });

  it("points a self-reference at the row itself", () => {
    const t = table("t", [key("id"), column("parent_id", "INTEGER")], [references("t", ["parent_id"], ["id"])]);

    expect(seedRows(model([t]), [], []).statements).toEqual(['INSERT INTO "t" ("id","parent_id") VALUES (1,1);']);
  });

  it("seeds both tables of a FOREIGN KEY cycle, each pointing at the other's row", () => {
    const a = table("a", [key("id"), column("b_id", "INTEGER")], [references("b", ["b_id"], ["id"])]);
    const b = table("b", [key("id"), column("a_id", "TEXT")], [references("a", ["a_id"], ["id"])]);

    expect(seedRows(model([a, b]), [], []).statements).toEqual([
      'INSERT INTO "a" ("id","b_id") VALUES (1,1);',
      `INSERT INTO "b" ("id","a_id") VALUES (1,'1');`,
    ]);
  });

  it("seeds nothing for a baseline with no tables", () => {
    expect(seedRows(model([]), [], [])).toEqual({ statements: [], tables: [] });
  });

  describe("eligibility", () => {
    const t = table("t", [key("id"), column("a", "TEXT")]);
    const other = table("other", [key("id")]);
    const baseline = model([t, other]);

    const leftOut: { name: string; step: DataDependentStep }[] = [
      { name: "a column CHECK", step: { kind: "column-check", table: "t", column: "a", check: "CHECK(A <> '')" } },
      { name: "a table CHECK", step: { kind: "table-check", table: "t", column: null, check: "CHECK(A <> '')" } },
      { name: "becoming STRICT", step: { kind: "becomes-strict", table: "t", column: null } },
      { name: "a type change under STRICT", step: { kind: "strict-type", table: "t", column: "a", from: "TEXT", to: "INTEGER" } },
    ];
    for (const { name, step } of leftOut) {
      it(`leaves out a table the desired schema gives ${name}`, () => {
        expect(seededTables(baseline, [step])).toEqual(["other"]);
      });
    }

    it("keeps a table whose only step is a NOT NULL tightening", () => {
      expect(seededTables(baseline, [{ kind: "not-null", table: "t", column: "a", defaulted: false }])).toEqual(["other", "t"]);
    });

    it("leaves out a table by the name a table --rename gives it", () => {
      const step: DataDependentStep = { kind: "becomes-strict", table: "renamed", column: null };

      expect(seededTables(baseline, [step], [{ kind: "table", from: "t", to: "renamed" }])).toEqual(["other"]);
    });

    describe("a child whose FK points into a left-out table", () => {
      const parent = table("parent", [key("id")]);
      const strict: DataDependentStep = { kind: "becomes-strict", table: "parent", column: null };

      it("is left out when the FK column is NOT NULL in the baseline", () => {
        const child = table("child", [key("id"), required("parent_id")], [references("parent", ["parent_id"], ["id"])]);

        expect(seededTables(model([parent, child]), [strict])).toEqual([]);
      });

      it("is left out when the FK column becomes NOT NULL in the desired schema, by its renamed name", () => {
        const child = table("child", [key("id"), column("parent_id", "INTEGER")], [references("parent", ["parent_id"], ["id"])]);
        const tightened: DataDependentStep = { kind: "not-null", table: "kid", column: "pid", defaulted: false };
        const renames: SchemaRename[] = [
          { kind: "table", from: "child", to: "kid" },
          { kind: "column", table: "child", from: "parent_id", to: "pid" },
        ];

        expect(seededTables(model([parent, child]), [strict, tightened], renames)).toEqual([]);
      });

      it("is left out when any column of a composite FK is NOT NULL", () => {
        const pair = table("pair", [column("a", "INTEGER", { pk: 1 }), column("b", "INTEGER", { pk: 2 })]);
        const child = table("child", [key("id"), column("pa", "INTEGER"), required("pb")], [references("pair", ["pa", "pb"], ["a", "b"])]);

        expect(seededTables(model([pair, child]), [{ kind: "becomes-strict", table: "pair", column: null }])).toEqual([]);
      });

      it("is left out transitively, through a grandchild's required reference", () => {
        const child = table("child", [key("id"), required("parent_id")], [references("parent", ["parent_id"], ["id"])]);
        const grandchild = table("grandchild", [key("id"), required("child_id")], [references("child", ["child_id"], ["id"])]);
        const bystander = table("bystander", [key("id")]);

        expect(seededTables(model([grandchild, child, parent, bystander]), [strict])).toEqual(["bystander"]);
      });

      it("is seeded with the FK column NULL when nothing requires it", () => {
        const child = table("child", [key("id"), column("parent_id", "INTEGER")], [references("parent", ["parent_id"], ["id"])]);

        expect(seedRows(model([parent, child]), [], [strict]).statements).toEqual(['INSERT INTO "child" ("id","parent_id") VALUES (1,NULL);']);
      });
    });

    describe("a child whose FK points at a table the baseline does not hold", () => {
      it("is seeded with the FK column NULL when it is nullable", () => {
        const child = table("child", [key("id"), column("ghost_id", "INTEGER")], [references("ghost", ["ghost_id"], ["id"])]);

        expect(seedRows(model([child]), [], []).statements).toEqual(['INSERT INTO "child" ("id","ghost_id") VALUES (1,NULL);']);
      });

      it("is left out when the FK column is NOT NULL", () => {
        const child = table("child", [key("id"), required("ghost_id")], [references("ghost", ["ghost_id"], ["id"])]);

        expect(seededTables(model([child]))).toEqual([]);
      });
    });
  });
});

const ROOT = "/app";
const BASELINE = `${ROOT}/.forge/scratch/compose/baseline`;
const SEED_FILE = `${BASELINE}/seed.sql`;
const PROOF_FILE = `${BASELINE}/proof.sql`;
const PROOF_SQL = 'CREATE INDEX "parent_a" ON "parent" ("a");\n';

function dbConfig(): DbConfig {
  return {
    root: ROOT,
    configPath: `${ROOT}/wrangler.jsonc`,
    config: {
      name: "app",
      compatibility_date: "2026-01-01",
      d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" }],
    } as WranglerConfig,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
    target: { place: "local", database: null },
  };
}

const INPUTS: SchemaInputs = {
  migrations: [],
  schemas: [],
  states: [],
  snapshotPath: `${ROOT}/config/db/schema.snapshot.json`,
  snapshot: null,
  claims: [],
};

interface Introspected {
  inventory: Record<string, unknown>[];
  columns: Record<string, unknown>[];
  foreignKeys: Record<string, unknown>[];
}

interface DeclaredTable {
  name: string;
  sql: string;
  columns: { name: string; type: string; notnull?: boolean; pk?: number; dflt?: string }[];
  references?: { from: string; parent: string; to: string }[];
}

function introspected(tables: DeclaredTable[]): Introspected {
  return {
    inventory: tables.map((t) => ({ type: "table", name: t.name, tbl_name: t.name, sql: t.sql })),
    columns: tables.flatMap((t) =>
      t.columns.map((c, cid) => ({
        tbl: t.name,
        cid,
        name: c.name,
        type: c.type,
        notnull: c.notnull === true ? 1 : 0,
        dflt_value: c.dflt ?? null,
        pk: c.pk ?? 0,
        hidden: 0,
      })),
    ),
    foreignKeys: tables.flatMap((t) =>
      (t.references ?? []).map((r, id) => ({
        tbl: t.name,
        id,
        seq: 0,
        parent: r.parent,
        from: r.from,
        to: r.to,
        on_update: "NO ACTION",
        on_delete: "NO ACTION",
      })),
    ),
  };
}

const assembled = (rows: Introspected) => assembleSchemaModel({ ...rows, indexList: [], indexColumns: [] });

const PARENT: DeclaredTable = {
  name: "parent",
  sql: "CREATE TABLE parent (id INTEGER PRIMARY KEY, a TEXT)",
  columns: [
    { name: "id", type: "INTEGER", pk: 1 },
    { name: "a", type: "TEXT" },
  ],
};
const CHILD: DeclaredTable = {
  name: "child",
  sql: "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent (id), note TEXT CHECK (note <> 'forge-seed'))",
  columns: [
    { name: "id", type: "INTEGER", pk: 1 },
    { name: "parent_id", type: "INTEGER" },
    { name: "note", type: "TEXT" },
  ],
  references: [{ from: "parent_id", parent: "parent", to: "id" }],
};
const FAMILY = introspected([CHILD, PARENT]);

/** What each table holds, one record per row as `quote()` reads every column; an absent table holds no row. */
type Stored = Record<string, Record<string, string>[]>;

const SEEDED_FAMILY: Stored = { parent: [{ id: "1", a: "'forge-seed'" }], child: [{ id: "1", parent_id: "1", note: "'forge-seed'" }] };

const unquoteIdentifier = (text: string) => text.replaceAll('""', '"');

/** Answers a survival read the way SQLite would over `stored`: each row of the named table, under each alias. */
function survivalAnswer(statement: string, stored: Stored): Record<string, unknown>[] {
  const from = /FROM "((?:[^"]|"")+)"$/.exec(statement)?.[1];
  const rows = from === undefined ? [] : (stored[unquoteIdentifier(from)] ?? []);
  const selected = [...statement.matchAll(/quote\("((?:[^"]|"")+)"\) AS "((?:[^"]|"")+)"/g)];
  return rows.map((row) =>
    Object.fromEntries(selected.map(([, quoted = "", alias = ""]) => [unquoteIdentifier(alias), row[unquoteIdentifier(quoted)] ?? "NULL"])),
  );
}

const SURVIVAL_READ = /^SELECT (?:quote\(|NULL AS "row")/;

interface Fake {
  readonly run: DbRunContext;
  readonly io: FakeDbIo;
  readonly timeline: string[];
  /** Every survival read sent, by the state the replay was in when it was sent. */
  readonly reads: { empty: string[]; seeded: string[]; migrated: string[] };
}

/** A replay that is empty until `seed.sql` commits, holds `seeded` until `proof.sql` runs, and holds `stored` after it. */
function proving(sides: {
  after: Introspected;
  seeded?: Stored;
  stored?: Stored;
  seedFails?: (statement: string) => Error | null;
  proofFails?: Error;
}): Fake {
  const io = fakeDbIo();
  const config = dbConfig();
  const run: DbRunContext = { config, home: appHome(config), io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} };
  const timeline: string[] = [];
  const reads: Fake["reads"] = { empty: [], seeded: [], migrated: [] };
  let state: keyof Fake["reads"] = "empty";
  const close = io.closeD1.bind(io);
  io.closeD1 = (home) => {
    timeline.push("replay");
    state = "empty";
    return close(home);
  };
  let current: string | null = null;
  const d1 = io.d1.bind(io);
  io.d1 = async (home, sql) => {
    current = sql.length === 1 ? ([...io.files].find(([, text]) => text === sql[0])?.[0] ?? null) : null;
    const survival = current === null && sql.every((statement) => SURVIVAL_READ.test(statement));
    timeline.push(current !== null ? basename(current) : survival ? "survival read" : "query");
    if (survival) reads[state].push(...sql);
    const answer = await d1(home, sql);
    if (current === SEED_FILE) state = "seeded";
    if (current === PROOF_FILE) state = "migrated";
    return answer;
  };
  io.d1Rules.push({
    match: () => true,
    reply: (statement) => {
      if (current === SEED_FILE) {
        const failure = sides.seedFails?.(statement) ?? null;
        if (failure !== null) throw failure;
        return [];
      }
      if (current === PROOF_FILE) {
        if (sides.proofFails !== undefined) throw sides.proofFails;
        return [];
      }
      if (!statement.startsWith("SELECT")) return [];
      const introspection = schemaModelRows(statement, sides.after);
      if (introspection.length > 0 || statement.includes("sqlite_master")) return introspection;
      const held = { empty: {}, seeded: sides.seeded ?? SEEDED_FAMILY, migrated: sides.stored ?? {} }[state];
      return survivalAnswer(statement, held);
    },
  });
  return { run, io, timeline, reads };
}

const proof = (baseline: SchemaModel, desired: SchemaModel, over: { renames?: SchemaRename[]; steps?: DataDependentStep[] } = {}) => ({
  sql: PROOF_SQL,
  baseline,
  desired,
  renames: over.renames ?? [],
  steps: over.steps ?? [],
});

const constraintError = (detail: string, extended: string) => new Error(`D1_ERROR: ${detail}: SQLITE_CONSTRAINT (extended: ${extended})`);

describe("proveComposed()", () => {
  const family = assembled(FAMILY);

  it("commits the seed, reads every seeded table in one batch, applies the migration, then reads the model and the seeded tables again, answering no warning", async () => {
    const { run, io, timeline, reads } = proving({ after: FAMILY, stored: SEEDED_FAMILY });

    const outcome = await proveComposed(run, INPUTS, proof(family, family));

    expect(outcome).toEqual({ model: family, warnings: [] });
    expect(timeline).toEqual(["replay", "seed.sql", "survival read", "proof.sql", "query", "survival read"]);
    expect({ empty: reads.empty.length, seeded: reads.seeded.length, migrated: reads.migrated.length }).toEqual({
      empty: 0,
      seeded: 2,
      migrated: 2,
    });
    expect(io.files.get(SEED_FILE)).toBe(
      "PRAGMA defer_foreign_keys = true;\n\n" +
        `INSERT INTO "parent" ("id","a") VALUES (1,'forge-seed');\n` +
        `INSERT INTO "child" ("id","parent_id","note") VALUES (1,1,'forge-seed');\n`,
    );
    expect(io.files.get(PROOF_FILE)).toBe(PROOF_SQL);
  });

  it("writes no seed for a baseline with no tables, and runs no survival read", async () => {
    const { run, io, timeline } = proving({ after: FAMILY });

    await expect(proveComposed(run, INPUTS, proof(model([]), family))).resolves.toEqual({ model: family, warnings: [] });
    expect(timeline).toEqual(["replay", "proof.sql", "query"]);
    expect(io.files.has(SEED_FILE)).toBe(false);
  });

  it("sends no seed statement through a pragma_ table-valued read", async () => {
    const { run, io } = proving({ after: FAMILY, stored: SEEDED_FAMILY });

    await proveComposed(run, INPUTS, proof(family, family));

    const seeded = io.d1Calls.filter((call) => call.source === SEED_FILE).flatMap((call) => call.statements);
    expect(seeded.length).toBe(3);
    expect(seeded.filter((statement) => statement.includes("pragma_"))).toEqual([]);
  });

  describe("a seed the baseline refuses with a row constraint", () => {
    const cases: { name: string; error: Error; warning: string }[] = [
      {
        name: "a CHECK, owned by the table whose DDL holds its expression",
        error: constraintError("CHECK constraint failed: note <> 'forge-seed'", "SQLITE_CONSTRAINT_CHECK"),
        warning: "warning: the proof ran without rows — seeding child failed: CHECK note <> 'forge-seed'",
      },
      {
        name: "a UNIQUE, owned by the table it names",
        error: constraintError("UNIQUE constraint failed: child.note", "SQLITE_CONSTRAINT_UNIQUE"),
        warning: "warning: the proof ran without rows — seeding child failed: UNIQUE child.note",
      },
      {
        name: "a NOT NULL, owned by the table it names",
        error: constraintError("NOT NULL constraint failed: parent.a", "SQLITE_CONSTRAINT_NOTNULL"),
        warning: "warning: the proof ran without rows — seeding parent failed: NOT NULL parent.a",
      },
      {
        name: "a bare FOREIGN KEY, which names no table",
        error: constraintError("FOREIGN KEY constraint failed", "SQLITE_CONSTRAINT_FOREIGNKEY"),
        warning: "warning: the proof ran without rows — seeding the baseline failed: FOREIGN KEY",
      },
      {
        name: "a trigger's RAISE, which says no 'constraint failed' and is owned by the trigger's table",
        error: constraintError("refused by guard", "SQLITE_CONSTRAINT_TRIGGER"),
        warning: "warning: the proof ran without rows — seeding child failed: refused by guard (SQLITE_CONSTRAINT_TRIGGER)",
      },
    ];
    const guarded: SchemaModel = {
      ...family,
      triggers: [
        {
          name: "child_guard",
          table: "child",
          sql: "CREATE TRIGGER child_guard BEFORE INSERT ON child BEGIN SELECT RAISE(ABORT, 'refused by guard'); END",
          normalized: "",
        },
      ],
    };

    for (const { name, error, warning } of cases) {
      it(`falls back to an empty replay and warns once: ${name}`, async () => {
        const { run, timeline } = proving({ after: FAMILY, seedFails: (statement) => (statement.startsWith("INSERT") ? error : null) });

        const outcome = await proveComposed(run, INPUTS, proof(guarded, family));

        expect(outcome).toEqual({ model: family, warnings: [warning] });
        expect(timeline).toEqual(["replay", "seed.sql", "replay", "proof.sql", "query"]);
      });
    }
  });

  describe("a seed that fails other than on a row constraint", () => {
    const cases: { name: string; error: Error }[] = [
      { name: "a non-constraint error", error: new Error("D1_ERROR: no such table: parent: SQLITE_ERROR") },
      { name: "a constraint with no extended code", error: new Error("D1_ERROR: UNIQUE constraint failed: child.note: SQLITE_CONSTRAINT") },
    ];

    for (const { name, error } of cases) {
      it(`rethrows ${name}, applying nothing`, async () => {
        const { run, timeline } = proving({ after: FAMILY, seedFails: () => error });

        await expect(proveComposed(run, INPUTS, proof(family, family))).rejects.toThrow(
          new CliError("external", `loading ${SEED_FILE} against scratch:compose-baseline (app-db-compose-baseline) failed:\n${error.message}`),
        );
        expect(timeline).toEqual(["replay", "seed.sql"]);
      });
    }
  });

  it("refuses a migration that does not apply to the seeded baseline", async () => {
    const { run } = proving({ after: FAMILY, proofFails: new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT") });

    await expect(proveComposed(run, INPUTS, proof(family, family))).rejects.toThrow(
      new CliError(
        "invalid-args",
        "the composed migration does not apply to the baseline — this is a forge bug, and the file was not written:\n" +
          `loading ${PROOF_FILE} against scratch:compose-baseline (app-db-compose-baseline) failed:\nD1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT`,
      ),
    );
  });

  it("refuses a migration that does not produce the declared schema", async () => {
    const { run } = proving({ after: introspected([PARENT]), stored: SEEDED_FAMILY });

    await expect(proveComposed(run, INPUTS, proof(family, family))).rejects.toThrow(
      new CliError(
        "invalid-args",
        "the composed migration does not produce the declared schema — this is a forge bug, and the file was not written:\n" +
          "  table child: in the declared schema, not in after the migration",
      ),
    );
  });

  describe("the survival check", () => {
    const lost = (lines: string[]) =>
      new CliError(
        "invalid-args",
        `the composed migration does not keep the rows it was proven over — this is a forge bug, and the file was not written:\n  ${lines.join("\n  ")}`,
      );

    it("refuses a seeded value that reads back changed, naming the table, column, seeded and read values", async () => {
      const { run } = proving({ after: FAMILY, stored: { ...SEEDED_FAMILY, parent: [{ id: "1", a: "NULL" }] } });

      await expect(proveComposed(run, INPUTS, proof(family, family))).rejects.toThrow(lost(["parent.a was seeded 'forge-seed' and reads NULL"]));
    });

    it("refuses a seeded row that is gone", async () => {
      const { run } = proving({ after: FAMILY, stored: { parent: SEEDED_FAMILY.parent ?? [] } });

      await expect(proveComposed(run, INPUTS, proof(family, family))).rejects.toThrow(
        lost(["a row seeded into child is gone: id = 1, parent_id = 1, note = 'forge-seed'"]),
      );
    });

    it("skips a column whose declared type changed", async () => {
      const retyped = introspected([
        {
          ...PARENT,
          sql: "CREATE TABLE parent (id INTEGER PRIMARY KEY, a INTEGER)",
          columns: [PARENT.columns[0] ?? { name: "id", type: "INTEGER" }, { name: "a", type: "INTEGER" }],
        },
        CHILD,
      ]);
      const { run } = proving({ after: retyped, stored: { ...SEEDED_FAMILY, parent: [{ id: "1", a: "0" }] } });

      await expect(proveComposed(run, INPUTS, proof(family, assembled(retyped)))).resolves.toEqual({ model: assembled(retyped), warnings: [] });
    });

    it("skips a column the desired schema drops, and reads nothing for a dropped table", async () => {
      const slim = introspected([
        { ...PARENT, sql: "CREATE TABLE parent (id INTEGER PRIMARY KEY)", columns: [{ name: "id", type: "INTEGER", pk: 1 }] },
      ]);
      const { run } = proving({ after: slim, stored: { parent: [{ id: "1" }] } });

      await expect(proveComposed(run, INPUTS, proof(family, assembled(slim)))).resolves.toEqual({ model: assembled(slim), warnings: [] });
    });

    describe("under a table and a column --rename", () => {
      const POSTS: DeclaredTable = {
        name: "posts",
        sql: "CREATE TABLE posts (id INTEGER PRIMARY KEY, body TEXT)",
        columns: [
          { name: "id", type: "INTEGER", pk: 1 },
          { name: "body", type: "TEXT" },
        ],
      };
      const ARTICLES = introspected([
        {
          name: "articles",
          sql: "CREATE TABLE articles (id INTEGER PRIMARY KEY, content TEXT)",
          columns: [
            { name: "id", type: "INTEGER", pk: 1 },
            { name: "content", type: "TEXT" },
          ],
        },
      ]);
      const renames: SchemaRename[] = [
        { kind: "table", from: "posts", to: "articles" },
        { kind: "column", table: "posts", from: "body", to: "content" },
      ];
      const baseline = assembled(introspected([POSTS]));
      const seeded: Stored = { posts: [{ id: "1", body: "'forge-seed'" }] };

      it("reads the seeded row back under its new names", async () => {
        const { run } = proving({ after: ARTICLES, seeded, stored: { articles: [{ id: "1", content: "'forge-seed'" }] } });

        await expect(proveComposed(run, INPUTS, proof(baseline, assembled(ARTICLES), { renames }))).resolves.toEqual({
          model: assembled(ARTICLES),
          warnings: [],
        });
      });

      it("names a lost value by its new names", async () => {
        const { run } = proving({ after: ARTICLES, seeded, stored: { articles: [{ id: "1", content: "NULL" }] } });

        await expect(proveComposed(run, INPUTS, proof(baseline, assembled(ARTICLES), { renames }))).rejects.toThrow(
          lost(["articles.content was seeded 'forge-seed' and reads NULL"]),
        );
      });

      it("reads the table under its baseline names before the migration and its new names after, aliased to the new names both times", async () => {
        const { run, reads } = proving({ after: ARTICLES, seeded, stored: { articles: [{ id: "1", content: "'forge-seed'" }] } });

        await proveComposed(run, INPUTS, proof(baseline, assembled(ARTICLES), { renames }));

        expect(reads).toEqual({
          empty: [],
          seeded: ['SELECT quote("id") AS "id", quote("body") AS "content" FROM "posts"'],
          migrated: ['SELECT quote("id") AS "id", quote("content") AS "content" FROM "articles"'],
        });
      });
    });

    describe("against what the seed left, a baseline trigger's writes included", () => {
      const TRAIL = introspected([
        {
          name: "audit",
          sql: "CREATE TABLE audit (id INTEGER PRIMARY KEY, action TEXT)",
          columns: [
            { name: "id", type: "INTEGER", pk: 1 },
            { name: "action", type: "TEXT" },
          ],
        },
        {
          name: "orders",
          sql: "CREATE TABLE orders (id INTEGER PRIMARY KEY, note TEXT)",
          columns: [
            { name: "id", type: "INTEGER", pk: 1 },
            { name: "note", type: "TEXT" },
          ],
        },
      ]);
      const trail = assembled(TRAIL);
      const orders = [{ id: "1", note: "'forge-seed'" }];
      const seeded: Stored = {
        audit: [
          { id: "1", action: "'forge-seed'" },
          { id: "2", action: "'created'" },
        ],
        orders,
      };

      it("accepts a row a trigger added to another seeded table during seeding", async () => {
        const { run } = proving({ after: TRAIL, seeded, stored: seeded });

        await expect(proveComposed(run, INPUTS, proof(trail, trail))).resolves.toEqual({ model: trail, warnings: [] });
      });

      it("accepts the same rows read back in another order", async () => {
        const { run } = proving({ after: TRAIL, seeded, stored: { audit: [...(seeded.audit ?? [])].reverse(), orders } });

        await expect(proveComposed(run, INPUTS, proof(trail, trail))).resolves.toEqual({ model: trail, warnings: [] });
      });

      it("accepts a value a trigger rewrote during seeding", async () => {
        const COUNTED = introspected([
          {
            name: "users",
            sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, order_count INTEGER)",
            columns: [
              { name: "id", type: "INTEGER", pk: 1 },
              { name: "order_count", type: "INTEGER" },
            ],
          },
        ]);
        const counted: Stored = { users: [{ id: "1", order_count: "2" }] };
        const { run } = proving({ after: COUNTED, seeded: counted, stored: counted });

        await expect(proveComposed(run, INPUTS, proof(assembled(COUNTED), assembled(COUNTED)))).resolves.toEqual({
          model: assembled(COUNTED),
          warnings: [],
        });
      });

      const refusals: { name: string; audit: Record<string, string>[]; lines: string[] }[] = [
        {
          name: "pairs a changed row with the row it held by primary key, naming the changed value",
          audit: [
            { id: "1", action: "'forge-seed'" },
            { id: "2", action: "'deleted'" },
          ],
          lines: ["audit.action was seeded 'created' and reads 'deleted'"],
        },
        {
          name: "names a row the trigger wrote that is gone",
          audit: [{ id: "1", action: "'forge-seed'" }],
          lines: ["a row seeded into audit is gone: id = 2, action = 'created'"],
        },
        {
          name: "names a row the table holds that it did not hold before the migration",
          audit: [
            { id: "1", action: "'forge-seed'" },
            { id: "2", action: "'created'" },
            { id: "3", action: "'created'" },
          ],
          lines: ["audit holds a row it was not seeded with: id = 3, action = 'created'"],
        },
        {
          name: "reports a row whose primary key changed as one gone and one extra",
          audit: [
            { id: "1", action: "'forge-seed'" },
            { id: "3", action: "'created'" },
          ],
          lines: [
            "a row seeded into audit is gone: id = 2, action = 'created'",
            "audit holds a row it was not seeded with: id = 3, action = 'created'",
          ],
        },
      ];
      for (const { name, audit, lines } of refusals) {
        it(`refuses, and ${name}`, async () => {
          const { run } = proving({ after: TRAIL, seeded, stored: { audit, orders } });

          await expect(proveComposed(run, INPUTS, proof(trail, trail))).rejects.toThrow(lost(lines));
        });
      }
    });

    describe("a table with no row identity", () => {
      const LOG = introspected([
        {
          name: "log",
          sql: "CREATE TABLE log (action TEXT, at TEXT)",
          columns: [
            { name: "action", type: "TEXT" },
            { name: "at", type: "TEXT" },
          ],
        },
      ]);
      const log = assembled(LOG);
      const row = { action: "'forge-seed'", at: "'forge-seed'" };
      const seeded: Stored = { log: [row, row] };

      it("accepts identical rows read back as many times as they were held", async () => {
        const { run } = proving({ after: LOG, seeded, stored: { log: [row, row] } });

        await expect(proveComposed(run, INPUTS, proof(log, log))).resolves.toEqual({ model: log, warnings: [] });
      });

      it("refuses one of two identical rows gone", async () => {
        const { run } = proving({ after: LOG, seeded, stored: { log: [row] } });

        await expect(proveComposed(run, INPUTS, proof(log, log))).rejects.toThrow(
          lost(["a row seeded into log is gone: action = 'forge-seed', at = 'forge-seed'"]),
        );
      });

      it("refuses a changed row with no primary key as one gone and one extra", async () => {
        const { run } = proving({ after: LOG, seeded, stored: { log: [row, { action: "'forge-seed'", at: "NULL" }] } });

        await expect(proveComposed(run, INPUTS, proof(log, log))).rejects.toThrow(
          lost([
            "a row seeded into log is gone: action = 'forge-seed', at = 'forge-seed'",
            "log holds a row it was not seeded with: action = 'forge-seed', at = NULL",
          ]),
        );
      });

      it("pairs no row by a primary key the desired schema keeps only part of", async () => {
        const PAIR = introspected([
          {
            name: "pair",
            sql: "CREATE TABLE pair (a INTEGER, b INTEGER, note TEXT, PRIMARY KEY (a, b))",
            columns: [
              { name: "a", type: "INTEGER", pk: 1 },
              { name: "b", type: "INTEGER", pk: 2 },
              { name: "note", type: "TEXT" },
            ],
          },
        ]);
        const HALVED = introspected([
          {
            name: "pair",
            sql: "CREATE TABLE pair (a INTEGER, note TEXT)",
            columns: [
              { name: "a", type: "INTEGER" },
              { name: "note", type: "TEXT" },
            ],
          },
        ]);
        const { run } = proving({
          after: HALVED,
          seeded: { pair: [{ a: "1", b: "1", note: "'forge-seed'" }] },
          stored: { pair: [{ a: "1", note: "NULL" }] },
        });

        await expect(proveComposed(run, INPUTS, proof(assembled(PAIR), assembled(HALVED)))).rejects.toThrow(
          lost(["a row seeded into pair is gone: a = 1, note = 'forge-seed'", "pair holds a row it was not seeded with: a = 1, note = NULL"]),
        );
      });

      it("still counts the rows of a table none of whose columns is kept", async () => {
        const RETYPED = introspected([{ name: "t", sql: "CREATE TABLE t (a INTEGER)", columns: [{ name: "a", type: "INTEGER" }] }]);
        const { run } = proving({ after: RETYPED, seeded: { t: [{ a: "'forge-seed'" }] }, stored: {} });

        await expect(
          proveComposed(
            run,
            INPUTS,
            proof(
              assembled(introspected([{ name: "t", sql: "CREATE TABLE t (a TEXT)", columns: [{ name: "a", type: "TEXT" }] }])),
              assembled(RETYPED),
            ),
          ),
        ).rejects.toThrow(lost(["a row seeded into t is gone"]));
      });
    });
  });
});
