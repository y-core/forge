import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { insertStatement, SqlReal, sqlValueExpression } from "../backup/artifact";
import { quoteSqlIdentifier, sqlColumnAffinity } from "../sql";
import type { DbRunContext, Home, SqlAffinity } from "../types";
import { executeFile, queryBatches } from "../wrangler";
import { columnTypeKey } from "./diff";
import { orderTablesByForeignKeys } from "./emit";
import { describeSchemaDifference, readSchemaModel } from "./introspect";
import { sqlIdentifierEquals, sqlIdentifierKey } from "./normalize";
import { replayBaseline } from "./scratch";
import type { ComposeProof, ComposeProofInput, DataDependentStep, RowSeed, SchemaInputs, SchemaModel, SchemaRename, SchemaTable } from "./types";

const SEED_VALUE: Readonly<Record<SqlAffinity, unknown>> = {
  INTEGER: 1,
  REAL: new SqlReal(1),
  TEXT: "forge-seed",
  BLOB: new Uint8Array([0]),
  NUMERIC: 1,
};

function storedValue(value: unknown, affinity: SqlAffinity): unknown {
  if (value === null) return null;
  if (affinity === "TEXT" && value instanceof SqlReal) return Number.isInteger(value.value) ? `${value.value}.0` : String(value.value);
  if (affinity === "TEXT" && typeof value === "number") return String(value);
  if ((affinity === "INTEGER" || affinity === "NUMERIC") && value instanceof SqlReal && Number.isInteger(value.value)) return value.value;
  if (affinity === "REAL" && typeof value === "number") return new SqlReal(value);
  return value;
}

interface RenameLookup {
  readonly table: (name: string) => string;
  readonly column: (table: string, name: string) => string;
}

function renameLookup(renames: readonly SchemaRename[]): RenameLookup {
  const table = (name: string) => renames.find((rename) => rename.kind === "table" && sqlIdentifierEquals(rename.from, name))?.to ?? name;
  const column = (owner: string, name: string) =>
    renames.find(
      (rename) =>
        rename.kind === "column" &&
        (sqlIdentifierEquals(rename.table, owner) || sqlIdentifierEquals(rename.table, table(owner))) &&
        sqlIdentifierEquals(rename.from, name),
    )?.to ?? name;
  return { table, column };
}

/** Baseline tables no row can be seeded into: a step other than NOT NULL tightening touches them, or a required reference points at one. */
function leftOutTables(baseline: SchemaModel, steps: readonly DataDependentStep[], renamed: RenameLookup): Set<string> {
  const blocked = new Set(steps.filter((step) => step.kind !== "not-null").map((step) => sqlIdentifierKey(step.table)));
  const tightened = new Set(
    steps.flatMap((step) => (step.kind === "not-null" ? [`${sqlIdentifierKey(step.table)}\0${sqlIdentifierKey(step.column)}`] : [])),
  );
  const present = new Set(baseline.tables.map((table) => sqlIdentifierKey(table.name)));
  const left = new Set(
    baseline.tables.filter((table) => blocked.has(sqlIdentifierKey(renamed.table(table.name)))).map((table) => sqlIdentifierKey(table.name)),
  );
  const required = (table: SchemaTable, name: string) => {
    const column = table.columns.find((candidate) => sqlIdentifierEquals(candidate.name, name));
    const after = `${sqlIdentifierKey(renamed.table(table.name))}\0${sqlIdentifierKey(renamed.column(table.name, name))}`;
    return column === undefined || column.notnull || column.pk > 0 || tightened.has(after);
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const table of baseline.tables) {
      if (left.has(sqlIdentifierKey(table.name))) continue;
      const stranded = table.foreignKeys.some(
        (fk) => (left.has(sqlIdentifierKey(fk.table)) || !present.has(sqlIdentifierKey(fk.table))) && fk.from.some((from) => required(table, from)),
      );
      if (!stranded) continue;
      left.add(sqlIdentifierKey(table.name));
      grew = true;
    }
  }
  return left;
}

/** The parent column each position of a foreign key points at, its primary key in key order where the reference names none. */
function referencedColumns(parent: SchemaTable, to: readonly (string | null)[]): (string | undefined)[] {
  const keys = parent.columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
  return to.map((name, index) => name ?? keys[index]?.name);
}

/** One synthetic row per eligible baseline table, consistent with its foreign keys and valid under both schemas, in parent-first order. @internal */
export function seedRows(baseline: SchemaModel, renames: readonly SchemaRename[], steps: readonly DataDependentStep[]): RowSeed {
  const renamed = renameLookup(renames);
  const left = leftOutTables(baseline, steps, renamed);
  const seeded = baseline.tables.filter((table) => !left.has(sqlIdentifierKey(table.name)));
  const byKey = new Map(seeded.map((table) => [sqlIdentifierKey(table.name), table]));
  const referenced = new Set(
    baseline.tables.flatMap((table) =>
      table.foreignKeys.flatMap((fk) => {
        const parent = baseline.tables.find((candidate) => sqlIdentifierEquals(candidate.name, fk.table));
        if (parent === undefined) return [];
        return referencedColumns(parent, fk.to).flatMap((name) =>
          name === undefined ? [] : [`${sqlIdentifierKey(parent.name)}\0${sqlIdentifierKey(name)}`],
        );
      }),
    ),
  );
  const isKey = (table: SchemaTable, name: string, pk: number) =>
    pk > 0 ||
    table.foreignKeys.some((fk) => fk.from.some((from) => sqlIdentifierEquals(from, name))) ||
    referenced.has(`${sqlIdentifierKey(table.name)}\0${sqlIdentifierKey(name)}`);

  const values = new Map(
    seeded.map((table) => [
      sqlIdentifierKey(table.name),
      new Map(
        table.columns
          .filter((column) => column.hidden === 0)
          .filter((column) => column.defaultExpr === null || /^NULL$/i.test(column.defaultExpr.trim()) || isKey(table, column.name, column.pk))
          .map((column) => [sqlIdentifierKey(column.name), SEED_VALUE[sqlColumnAffinity(column.type)]]),
      ),
    ]),
  );
  const affinityOf = (table: SchemaTable, name: string) =>
    sqlColumnAffinity(table.columns.find((column) => sqlIdentifierEquals(column.name, name))?.type ?? "");

  for (let pass = 0, changed = true; changed && pass <= seeded.length; pass += 1) {
    changed = false;
    for (const table of seeded) {
      const row = values.get(sqlIdentifierKey(table.name));
      if (row === undefined) continue;
      for (const fk of table.foreignKeys) {
        const parent = byKey.get(sqlIdentifierKey(fk.table));
        const parentRow = values.get(sqlIdentifierKey(fk.table));
        const targets = parent === undefined ? [] : referencedColumns(parent, fk.to);
        fk.from.forEach((from, index) => {
          const target = targets[index];
          const value =
            parent === undefined || parentRow === undefined
              ? null
              : storedValue(target === undefined ? undefined : parentRow.get(sqlIdentifierKey(target)), affinityOf(table, from));
          if (value === undefined) return;
          const key = sqlIdentifierKey(from);
          if (row.has(key) && sqlValueExpression(from, row.get(key)) === sqlValueExpression(from, value)) return;
          row.set(key, value);
          changed = true;
        });
      }
    }
  }

  const ordered = orderTablesByForeignKeys(seeded);
  const statements = ordered.map((table) => {
    const row = values.get(sqlIdentifierKey(table.name)) ?? new Map<string, unknown>();
    const columns = table.columns.filter((column) => row.has(sqlIdentifierKey(column.name))).map((column) => column.name);
    if (columns.length === 0) return `INSERT INTO ${quoteSqlIdentifier(table.name)} DEFAULT VALUES;`;
    return insertStatement(table.name, columns, Object.fromEntries(columns.map((column) => [column, row.get(sqlIdentifierKey(column))])));
  });
  return { statements, tables: ordered.map((table) => table.name) };
}

const SEED_REFUSAL = /([^\n]*?):\s*SQLITE_CONSTRAINT \(extended: (SQLITE_CONSTRAINT_\w+)\)/;
const SEED_WATCHED_REFUSAL = /^FOREIGN KEY constraint failed: (.+) first held a row with no match in /m;

/** The advisory line for a seed the baseline refused, naming the table and constraint as far as the D1 error does. */
function describeSeedRefusal(match: RegExpExecArray, baseline: SchemaModel, tables: readonly string[]): string {
  const reason = (match[1] ?? "").replace(/^(?:.*violated: |D1_ERROR: )/, "").trim();
  const failed = /^(.*?) constraint failed:?\s*(.*)$/.exec(reason);
  const constraint =
    failed === null ? `${reason} (${match[2] ?? ""})` : [failed[1], failed[2]].filter((part) => part !== undefined && part !== "").join(" ");
  const detail = failed?.[2] ?? reason;
  const named = /(?:constraint failed: |column )([^\s.:,()]+)\./.exec(reason)?.[1];
  const seeded = (name: string) => tables.some((table) => sqlIdentifierEquals(table, name));
  const owner =
    named ??
    (detail === ""
      ? undefined
      : (baseline.tables.find((table) => seeded(table.name) && table.sql.includes(detail))?.name ??
        baseline.triggers.find((trigger) => seeded(trigger.table) && trigger.sql.includes(detail))?.table));
  return `warning: the proof ran without rows — seeding ${owner ?? "the baseline"} failed: ${constraint}`;
}

/** Commits the seed in its own transaction, answering the advisory line when a row constraint refuses it. */
async function commitSeed(run: DbRunContext, home: Home, seed: RowSeed, baseline: SchemaModel): Promise<string | null> {
  const file = join(home.dir, "seed.sql");
  run.io.writeText(file, `PRAGMA defer_foreign_keys = true;\n\n${seed.statements.join("\n")}\n`);
  try {
    await executeFile(run.io, home, file);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const child = SEED_WATCHED_REFUSAL.exec(message)?.[1];
    if (child !== undefined) return `warning: the proof ran without rows — seeding ${child} failed: FOREIGN KEY`;
    const match = SEED_REFUSAL.exec(message);
    if (match === null) throw error;
    return describeSeedRefusal(match, baseline, seed.tables);
  }
}

interface KeptColumn {
  readonly before: string;
  readonly after: string;
}

interface SurvivalCheck {
  readonly table: string;
  readonly columns: readonly KeptColumn[];
  /** Positions in `columns` of the baseline primary key, empty when the table has none or the desired schema drops a part of it. */
  readonly key: readonly number[];
  readonly before: string;
  readonly after: string;
}

function survivalRead(table: string, columns: readonly string[], aliases: readonly string[]): string {
  const selected =
    columns.length === 0
      ? `NULL AS "row"`
      : columns.map((column, index) => `quote(${quoteSqlIdentifier(column)}) AS ${quoteSqlIdentifier(aliases[index] ?? column)}`).join(", ");
  return `SELECT ${selected} FROM ${quoteSqlIdentifier(table)}`;
}

/** One read per seeded table that survives, of every row's kept columns under their baseline names and again under their desired ones. */
function survivalChecks(tables: readonly string[], proof: ComposeProofInput): SurvivalCheck[] {
  const renamed = renameLookup(proof.renames);
  return tables.flatMap((name) => {
    const before = proof.baseline.tables.find((table) => sqlIdentifierEquals(table.name, name));
    const after = proof.desired.tables.find((table) => sqlIdentifierEquals(table.name, renamed.table(name)));
    if (before === undefined || after === undefined) return [];
    const kept = before.columns.flatMap((was) => {
      const now = after.columns.find((candidate) => sqlIdentifierEquals(candidate.name, renamed.column(before.name, was.name)));
      if (was.hidden !== 0 || now === undefined || now.hidden !== 0 || columnTypeKey(was.type) !== columnTypeKey(now.type)) return [];
      return [{ column: { before: was.name, after: now.name }, pk: was.pk }];
    });
    const keyCount = before.columns.filter((column) => column.pk > 0).length;
    const key = kept.flatMap((entry, index) => (entry.pk > 0 ? [index] : []));
    const columns = kept.map((entry) => entry.column);
    const afterNames = columns.map((column) => column.after);
    return [
      {
        table: after.name,
        columns,
        key: key.length === keyCount ? key : [],
        before: survivalRead(
          before.name,
          columns.map((column) => column.before),
          afterNames,
        ),
        after: survivalRead(after.name, afterNames, afterNames),
      },
    ];
  });
}

/** What each check's table holds, one `quote()` tuple per row in `columns` order. */
async function readSurvivalTuples(
  run: DbRunContext,
  home: Home,
  checks: readonly SurvivalCheck[],
  read: "before" | "after",
): Promise<string[][][]> {
  if (checks.length === 0) return [];
  const answers = await queryBatches(
    run.io,
    home,
    checks.map((check) => check[read]),
  );
  return checks.map((check, index) => (answers[index] ?? []).map((row) => check.columns.map((column) => String(row[column.after]))));
}

/** The tuples of `from` left over once each tuple of `against` has cancelled one equal to it. */
function unmatchedTuples(from: readonly string[][], against: readonly string[][]): string[][] {
  const pending = new Map<string, number>();
  for (const identity of against.map((tuple) => JSON.stringify(tuple))) pending.set(identity, (pending.get(identity) ?? 0) + 1);
  return from.filter((tuple) => {
    const identity = JSON.stringify(tuple);
    const count = pending.get(identity) ?? 0;
    if (count === 0) return true;
    pending.set(identity, count - 1);
    return false;
  });
}

/** Each way the rows read after the migration differ from those held before it, pairing a changed row with its original by primary key. */
function describeLostRows(check: SurvivalCheck, held: readonly string[][], read: readonly string[][]): string[] {
  const spelled = (tuple: readonly string[]) =>
    check.columns.length === 0 ? "" : `: ${check.columns.map((column, index) => `${column.after} = ${tuple[index] ?? "?"}`).join(", ")}`;
  const identity = (tuple: readonly string[]) => JSON.stringify(check.key.map((index) => tuple[index]));
  const extra = unmatchedTuples(read, held);
  const lost = unmatchedTuples(held, read).flatMap((was) => {
    const paired = check.key.length === 0 ? -1 : extra.findIndex((now) => identity(now) === identity(was));
    if (paired === -1) return [`a row seeded into ${check.table} is gone${spelled(was)}`];
    const now = extra.splice(paired, 1)[0] ?? [];
    return check.columns.flatMap((column, index) =>
      was[index] === now[index] ? [] : [`${check.table}.${column.after} was seeded ${was[index] ?? "?"} and reads ${now[index] ?? "?"}`],
    );
  });
  return [...lost, ...extra.map((now) => `${check.table} holds a row it was not seeded with${spelled(now)}`)];
}

/** Refuses the migration when a seeded table no longer holds the rows it held before the migration ran, kept values included. */
async function refuseLostRows(run: DbRunContext, home: Home, checks: readonly SurvivalCheck[], held: readonly string[][][]): Promise<void> {
  const read = await readSurvivalTuples(run, home, checks, "after");
  const lost = checks.flatMap((check, index) => describeLostRows(check, held[index] ?? [], read[index] ?? []));
  if (lost.length === 0) return;
  throw new CliError(
    "invalid-args",
    `the composed migration does not keep the rows it was proven over — this is a forge bug, and the file was not written:\n  ${lost.join("\n  ")}`,
  );
}

/** Applies the emitted SQL to a replay holding one seeded row per eligible table, refusing to write it unless the result is the desired model and every seeded table kept the rows it held. @internal */
export async function proveComposed(run: DbRunContext, inputs: SchemaInputs, proof: ComposeProofInput): Promise<ComposeProof> {
  const seed = seedRows(proof.baseline, proof.renames, proof.steps);
  const replay = await replayBaseline(run, inputs.migrations);
  const refusal = seed.statements.length === 0 ? null : await commitSeed(run, replay, seed, proof.baseline);
  const home = refusal === null ? replay : await replayBaseline(run, inputs.migrations);
  const checks = refusal === null ? survivalChecks(seed.tables, proof) : [];
  const held = await readSurvivalTuples(run, home, checks, "before");

  const file = join(home.dir, "proof.sql");
  run.io.writeText(file, proof.sql);
  try {
    await executeFile(run.io, home, file);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      "invalid-args",
      `the composed migration does not apply to the baseline — this is a forge bug, and the file was not written:\n${detail}`,
    );
  }
  const model = await readSchemaModel(run.io, home);
  const difference = describeSchemaDifference(model, proof.desired, { left: "after the migration", right: "the declared schema" });
  if (difference.length > 0) {
    throw new CliError(
      "invalid-args",
      `the composed migration does not produce the declared schema — this is a forge bug, and the file was not written:\n  ${difference.join("\n  ")}`,
    );
  }
  await refuseLostRows(run, home, checks, held);
  return { model, warnings: refusal === null ? [] : [refusal] };
}
