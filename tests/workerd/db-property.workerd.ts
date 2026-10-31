import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import fc from "fast-check";

import type { MigrationFinding } from "../../src/tooling/db/migrate/types";
import type { DbRunContext } from "../../src/tooling/db/types";
import { renderRows, renderSchema, type SchemaPair, schemaPairArbitrary } from "./db-schema-pairs.fixture";

async function loadForge() {
  const [context, analysis, apply, files, compose, header, d1] = await Promise.all([
    import("../../src/tooling/db/context"),
    import("../../src/tooling/db/migrate/analysis"),
    import("../../src/tooling/db/migrate/apply"),
    import("../../src/tooling/db/migrate/files"),
    import("../../src/tooling/db/schema/compose"),
    import("../../src/tooling/db/schema/header"),
    import("./d1"),
  ]);
  return {
    withDbRun: context.withDbRun,
    analyseMigrations: analysis.analyseMigrations,
    readTargetFacts: apply.readTargetFacts,
    runMigrate: apply.runMigrate,
    readMigrations: files.readMigrations,
    composeMigration: compose.composeMigration,
    parseMigrationHeader: header.parseMigrationHeader,
    openD1: d1.openD1,
  };
}

let forge: Awaited<ReturnType<typeof loadForge>>;

const FORGE = fileURLToPath(new URL("../..", import.meta.url));
const SEEDS = [20261017, 4242] as const;
const RUNS_PER_SEED = 6;
const CASE_CONCURRENCY = 1;
const DIGEST = /--allow-destructive ([0-9a-f]{12})/;
const REBUILD_INSERT = /INSERT INTO "_forge_new_((?:[^"]|"")+)" \(([^)]*)\) SELECT ([^)]*?) FROM "((?:[^"]|"")+)";/g;

interface InventoryTable {
  name: string;
  columns: { name: string; hidden: number }[];
  rows: Record<string, unknown>[];
}

interface Inventory {
  tables: InventoryTable[];
  views: string[];
}

interface Observed {
  before: Inventory;
  after: Inventory;
  renames: readonly string[];
}

interface Outcome {
  label: string;
  pair: SchemaPair;
  status: "accepted" | "discarded" | "violation" | "unapplied";
  reason: string;
  written: string;
  observed: Observed | null;
  findings: MigrationFinding[];
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const key = (name: string) => name.toLowerCase();
const isAppObject = (name: string) => !["sqlite_", "_cf_", "_forge_"].some((prefix) => name.startsWith(prefix)) && name !== "d1_migrations";

type Query = (sql: string) => Promise<Record<string, unknown>[]>;

const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

async function readInventory(query: Query): Promise<Inventory> {
  const objects = (await query("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view')")) as { type: string; name: string }[];
  const own = objects.filter((object) => isAppObject(object.name));
  const tables: InventoryTable[] = [];
  for (const { name } of own.filter((object) => object.type === "table")) {
    const columns = (await query(`SELECT name, hidden FROM pragma_table_xinfo(${literal(name)})`)) as { name: string; hidden: number }[];
    const plain = columns.filter((column) => column.hidden === 0).map((column) => quote(column.name));
    tables.push({ name, columns, rows: await query(`SELECT ${plain.join(", ")} FROM ${quote(name)} ORDER BY "id"`) });
  }
  return { tables, views: own.filter((object) => object.type === "view").map((object) => object.name) };
}

const targetQuery =
  (run: DbRunContext): Query =>
  async (sql) =>
    (await run.io.d1(run.home, [sql]))[0] ?? [];

interface Rename {
  kind: "table" | "column";
  table: string;
  from: string;
  to: string;
}

function parseRename(spec: string): Rename {
  const [left = "", to = ""] = spec.split(":");
  const dot = left.indexOf(".");
  return dot === -1 ? { kind: "table", table: left, from: left, to } : { kind: "column", table: left.slice(0, dot), from: left.slice(dot + 1), to };
}

const renameKey = (rename: Rename) =>
  `incompatible|renames|${rename.kind}|${rename.kind === "column" ? rename.table : ""}|${rename.from}>${rename.to}`;

interface Renamed {
  tables: InventoryTable[];
  origin: (table: string) => string;
}

function applyRenames(before: Inventory, renames: readonly string[]): Renamed {
  let tables = before.tables.map((table) => ({ ...table, columns: table.columns.map((column) => ({ ...column })) }));
  const origins = new Map<string, string>();
  for (const rename of renames.map(parseRename)) {
    const table = tables.find((candidate) => key(candidate.name) === key(rename.table));
    if (table === undefined) continue;
    if (rename.kind === "table") {
      origins.set(key(rename.to), origins.get(key(table.name)) ?? table.name);
      origins.delete(key(table.name));
      tables = tables.map((candidate) => (candidate === table ? { ...table, name: rename.to } : candidate));
      continue;
    }
    const column = table.columns.find((candidate) => key(candidate.name) === key(rename.from));
    if (column !== undefined) {
      column.name = rename.to;
      table.rows = table.rows.map((row) => {
        const { [rename.from]: value, ...rest } = row;
        return { ...rest, [rename.to]: value };
      });
    }
  }
  return { tables, origin: (name) => origins.get(key(name)) ?? name };
}

function expectedFindings(observed: Observed): string[] {
  const { tables, origin } = applyRenames(observed.before, observed.renames);
  const after = new Map(observed.after.tables.map((table) => [key(table.name), table]));
  const expected: string[] = [];
  for (const table of tables) {
    const kept = after.get(key(table.name));
    if (kept === undefined) {
      expected.push(`destructive|drops|table||${origin(table.name)}`);
      continue;
    }
    const keptColumns = new Set(kept.columns.map((column) => key(column.name)));
    for (const column of table.columns.filter((candidate) => !keptColumns.has(key(candidate.name)))) {
      expected.push(`${column.hidden === 2 ? "incompatible" : "destructive"}|drops|column|${origin(table.name)}|${column.name}`);
    }
  }
  const keptViews = new Set(observed.after.views.map(key));
  for (const view of observed.before.views.filter((name) => !keptViews.has(key(name)))) expected.push(`incompatible|drops|view||${view}`);
  expected.push(...observed.renames.map((spec) => renameKey(parseRename(spec))));
  return expected.map(key);
}

function findingKey(finding: MigrationFinding): string {
  const { change } = finding;
  const parts =
    change.action === "renames"
      ? [change.rename.kind, change.rename.kind === "column" ? change.rename.table : "", `${change.rename.from}>${change.rename.to}`]
      : [change.object.type, change.object.type === "column" ? change.object.table : "", change.object.name];
  return key([finding.severity, change.action, ...parts].join("|"));
}

function schemaViolations(observed: Observed, findings: readonly MigrationFinding[]): string[] {
  const unmatched = findings.map(findingKey);
  const missing: string[] = [];
  for (const wanted of expectedFindings(observed)) {
    const at = unmatched.indexOf(wanted);
    if (at === -1) missing.push(`missing ${wanted}`);
    else unmatched.splice(at, 1);
  }
  return [...missing, ...unmatched.map((extra) => `extra ${extra}`)];
}

function dataViolations(observed: Observed): string[] {
  const { tables } = applyRenames(observed.before, observed.renames);
  const after = new Map(observed.after.tables.map((table) => [key(table.name), table]));
  const lines: string[] = [];
  for (const table of tables) {
    const kept = after.get(key(table.name));
    if (kept === undefined) continue;
    const plainAfter = new Set(kept.columns.filter((column) => column.hidden === 0).map((column) => column.name));
    const columns = table.columns.filter((column) => column.hidden === 0 && plainAfter.has(column.name)).map((column) => column.name);
    const rowsAfter = new Map(kept.rows.map((row) => [row.id, row]));
    for (const row of table.rows) {
      const now = rowsAfter.get(row.id);
      for (const column of columns) {
        if (now?.[column] !== row[column]) {
          lines.push(`${table.name}.${column} id=${String(row.id)}: before ${JSON.stringify(row[column])} after ${JSON.stringify(now?.[column])}`);
        }
      }
    }
  }
  return lines;
}

const roots: string[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-property-"));
  roots.push(root);
  cpSync(join(FORGE, "tests", "fixtures", "db-compose", "wrangler.jsonc"), join(root, "wrangler.jsonc"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "db.config.ts"), 'export default { schemas: ["schema.sql"] };\n');
  return root;
}

function inRun<T>(root: string, body: (run: DbRunContext) => Promise<T>): Promise<T> {
  const flags = { root, target: "local", db: undefined, config: "wrangler.jsonc", env: undefined, json: true, yes: true };
  return forge.withDbRun(flags, undefined, { host: { schemas: ["schema.sql"] } }, body);
}

const MIGRATE = { dryRun: false, bookmark: false, rehearse: false };

async function composeApproved(run: DbRunContext, renames: readonly string[]): Promise<string | null> {
  const compose = (allowDestructive?: string) =>
    forge.composeMigration(run, {
      name: "change",
      dryRun: false,
      renames,
      cache: true,
      ...(allowDestructive === undefined ? {} : { allowDestructive }),
    });
  try {
    const outcome = await compose();
    return outcome.path === null ? null : outcome.sql;
  } catch (error) {
    const digest = DIGEST.exec(message(error))?.[1];
    if (digest === undefined) throw error;
    const outcome = await compose(digest);
    return outcome.path === null ? null : outcome.sql;
  }
}

async function runPair(pair: SchemaPair, label: string): Promise<Outcome> {
  const root = freshRoot();
  const outcome = (status: Outcome["status"], reason: string, rest: Partial<Outcome> = {}): Outcome => ({
    label,
    pair,
    status,
    reason,
    written: "",
    observed: null,
    findings: [],
    ...rest,
  });
  try {
    writeFileSync(join(root, "schema.sql"), renderSchema(pair.before));
    await inRun(root, async (run) => {
      await forge.composeMigration(run, { name: "init", dryRun: false, renames: [], cache: true });
      await run.io.closeD1(null);
      await forge.runMigrate(run, MIGRATE);
      await run.io.d1(run.home, [renderRows(pair.before)]);
    });

    writeFileSync(join(root, "schema.sql"), renderSchema(pair.after));
    return await inRun(root, async (run) => {
      let written: string | null;
      try {
        written = await composeApproved(run, pair.renames);
      } catch (error) {
        return outcome("discarded", `compose refused: ${message(error)}`);
      }
      if (written === null) return outcome("discarded", "compose wrote no migration");
      await run.io.closeD1(null);

      const before = await readInventory(targetQuery(run));
      let findings: MigrationFinding[];
      try {
        const facts = await forge.readTargetFacts(run.io, run.home);
        const recorded = new Set(facts.recorded.map((row) => row.appliedName));
        const pending = forge.readMigrations(run).filter((migration) => !recorded.has(migration.name));
        findings = await forge.analyseMigrations(run, pending, facts.inventory);
      } catch (error) {
        return outcome("violation", `the analysis refused what compose wrote: ${message(error)}`, { written });
      }
      try {
        await forge.runMigrate(run, MIGRATE);
      } catch (error) {
        return outcome("unapplied", message(error), { written, findings });
      }
      const observed = { before, after: await readInventory(targetQuery(run)), renames: pair.renames };
      return outcome("accepted", "", { written, observed, findings });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function pooled<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function rebuiltTables(written: string): { table: string; columns: string[]; statement: string }[] {
  return [...written.matchAll(REBUILD_INSERT)].map((match) => ({
    table: (match[1] ?? "").replaceAll('""', '"'),
    columns: (match[2] ?? "").split(", "),
    statement: match[0],
  }));
}

const pairs = SEEDS.flatMap((seed) =>
  fc.sample(schemaPairArbitrary(), { seed, numRuns: RUNS_PER_SEED }).map((pair, index) => ({ pair, label: `seed ${seed} #${index}` })),
);
let outcomes: Outcome[] = [];
const accepted = () => outcomes.filter((outcome) => outcome.status === "accepted");
const describe = (outcome: Outcome, lines: readonly string[]) =>
  `${outcome.label} (${outcome.pair.operations.join("; ")}):\n  ${lines.join("\n  ")}`;
const reusedRenames = (outcome: Outcome) =>
  outcome.pair.renames.map(parseRename).filter((rename) => {
    const after = outcome.observed?.after;
    if (rename.kind === "table") return after?.tables.some((table) => key(table.name) === key(rename.from)) === true;
    const table = after?.tables.find((candidate) => key(candidate.name) === key(rename.table));
    return table?.columns.some((column) => key(column.name) === key(rename.from)) === true;
  });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(900_000);
  forge = await loadForge();
  outcomes = await pooled(pairs, CASE_CONCURRENCY, ({ pair, label }) => runPair(pair, label));
});

test.afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("compose and the analysis agree on every pair compose accepts", () => {
  const violations = outcomes.filter((outcome) => outcome.status === "violation");
  expect(violations.map((outcome) => describe(outcome, [outcome.reason]))).toEqual([]);
});

test("the analysis reports every removal, and nothing else", () => {
  const failures = accepted().flatMap((outcome) => {
    const lines = schemaViolations(outcome.observed as Observed, outcome.findings);
    return lines.length === 0 ? [] : [describe(outcome, lines)];
  });
  expect(failures).toEqual([]);
});

test("compose loses no kept row value", () => {
  const failures = accepted().flatMap((outcome) => {
    const lines = dataViolations(outcome.observed as Observed);
    return lines.length === 0 ? [] : [describe(outcome, lines)];
  });
  expect(failures).toEqual([]);
});

test("views, virtual columns and renames are incompatible only; a reused-name rename is one rename finding and no drop", () => {
  const hiddenOf = (outcome: Outcome, table: string, column: string) =>
    outcome.observed?.before.tables
      .find((candidate) => key(candidate.name) === key(table))
      ?.columns.find((candidate) => key(candidate.name) === key(column))?.hidden;
  const kinds = new Set<string>();
  const failures: string[] = [];
  for (const outcome of accepted()) {
    for (const finding of outcome.findings) {
      const { change } = finding;
      const kind =
        change.action === "renames"
          ? "rename"
          : change.object.type === "view"
            ? "view"
            : change.object.type === "column" && hiddenOf(outcome, change.object.table, change.object.name) === 2
              ? "virtual column"
              : null;
      if (kind === null) continue;
      kinds.add(kind);
      if (finding.severity !== "incompatible") failures.push(describe(outcome, [`${findingKey(finding)} is ${finding.severity}`]));
    }
    for (const rename of reusedRenames(outcome)) {
      const named = outcome.findings.filter((finding) =>
        finding.change.action === "renames"
          ? key(finding.change.rename.from) === key(rename.from)
          : key(finding.change.object.name) === key(rename.from),
      );
      expect(named.map(findingKey), describe(outcome, [`the ${rename.kind} rename of ${rename.from}`])).toEqual([key(renameKey(rename))]);
    }
  }
  expect(failures).toEqual([]);
  expect([...kinds].toSorted()).toEqual(["rename", "view", "virtual column"]);
});

test("the accepted pairs hold a drop, a rebuild over rows and a reused-name rename", () => {
  const discarded = outcomes.filter((outcome) => outcome.status === "discarded");
  const summary = `${discarded.length} of ${outcomes.length} discarded:\n  ${discarded.map((outcome) => `${outcome.label}: ${outcome.reason.split("\n")[0]}`).join("\n  ")}`;
  const withDrop = accepted().filter((outcome) => outcome.findings.some((finding) => finding.change.action === "drops"));
  const withRebuild = accepted().filter((outcome) =>
    rebuiltTables(outcome.written).some(({ table }) =>
      applyRenames((outcome.observed as Observed).before, outcome.pair.renames).tables.some(
        (candidate) => key(candidate.name) === key(table) && candidate.rows.length > 0,
      ),
    ),
  );
  const withReuse = accepted().filter((outcome) => reusedRenames(outcome).length > 0);
  expect(
    { drop: withDrop.length >= 3, rebuild: withRebuild.length >= 2, reuse: withReuse.length >= 1, accepted: discarded.length < outcomes.length },
    `${summary}\ndrop ${withDrop.length}, rebuild ${withRebuild.length}, reuse ${withReuse.length}`,
  ).toEqual({ drop: true, rebuild: true, reuse: true, accepted: true });
});

test("the schema oracle fails an analysis that omits one finding", () => {
  const outcome = accepted().find((candidate) => candidate.findings.length > 0);
  expect(outcome).toBeDefined();
  const omitted = (outcome as Outcome).findings[0] as MigrationFinding;
  expect(schemaViolations(outcome?.observed as Observed, (outcome as Outcome).findings.slice(1))).toEqual([`missing ${findingKey(omitted)}`]);
});

test("the data oracle fails a rebuild that leaves a kept column out of its INSERT … SELECT", async () => {
  test.setTimeout(120_000);
  const chosen = accepted().flatMap((outcome) =>
    rebuiltTables(outcome.written).flatMap(({ table, columns, statement }) => {
      const column = columns.find((candidate) => candidate !== '"id"');
      return column === undefined ? [] : [{ outcome, table, column, statement, columns }];
    }),
  )[0];
  expect(chosen).toBeDefined();
  const { outcome, table, column, statement, columns } = chosen as NonNullable<typeof chosen>;
  const kept = columns.filter((candidate) => candidate !== column).join(", ");
  const sabotaged = forge
    .parseMigrationHeader(outcome.written)
    .body.replace(
      statement,
      `INSERT INTO ${quote(`_forge_new_${table}`)} (${kept}) SELECT ${kept} FROM ${statement.slice(statement.lastIndexOf(" FROM ") + " FROM ".length)}`,
    );
  const root = freshRoot();
  const db = await forge.openD1(root);
  try {
    await db.exec(renderSchema(outcome.pair.before));
    await db.exec(renderRows(outcome.pair.before));
    const before = await readInventory((sql) => db.rows(sql));
    await db.exec(sabotaged);
    const lines = dataViolations({ before, after: await readInventory((sql) => db.rows(sql)), renames: outcome.pair.renames });
    const name = column.slice(1, -1).replaceAll('""', '"');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((line) => !line.startsWith(`${table}.${name} `))).toEqual([]);
  } finally {
    await db.dispose();
  }
});

test("every migration compose writes applies over rows that satisfy both schemas", () => {
  const unapplied = outcomes.filter((outcome) => outcome.status === "unapplied");
  expect(unapplied.map((outcome) => describe(outcome, [outcome.reason]))).toEqual([]);
});
