import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

import { DB_LAYOUT, inMigrationOrder, isMigrationFileName } from "../storage/db/migrations";
import { INVENTORY_SELECT } from "../storage/db/schema";
import type { D1Database, SqlFragment } from "../storage/db/types";
import { declaredPath, DEFAULT_DB_CONFIG, loadHostConfig } from "../tooling/db/declared";

export { sql } from "../storage/db/sql";

/** Where `openTestD1` reads the app from; every path is relative to `root`, the current directory where unset. @public */
export interface OpenTestD1Options {
  root?: string;
  /** The `DbHostConfig` module naming the migrations directory; `config/db.ts` where unset. */
  hostConfig?: string;
  /** Overrides the migrations directory the host config names. */
  migrations?: string;
}

/** A local D1 database with every migration applied, private to the handle that opened it. @public */
export interface TestD1 {
  binding: D1Database;
  rows<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Drops every object the app made and applies the migrations again, on the same workerd process. */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

/** A `DB` binding over getPlatformProxy, and the workerd process behind it. @internal */
export interface PlatformD1 {
  binding: D1Database;
  dispose(): Promise<void>;
}

/** Opens the `DB` binding `configPath` declares, its state under `persistPath`, swept if the run is interrupted. @internal */
export async function openPlatformD1(configPath: string, persistPath: string): Promise<PlatformD1> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath, persist: { path: persistPath }, remoteBindings: false, envFiles: [] });
  let open = true;
  const dispose = async (): Promise<void> => {
    if (!open) return;
    open = false;
    live.delete(dispose);
    await proxy.dispose();
  };
  live.add(dispose);
  sweepOnSignal();
  return { binding: proxy.env.DB, dispose };
}

const live = new Set<() => Promise<void>>();

// The handler ends the run itself: a listener suppresses the runtime's default termination, and a run that
// carries on past one meets the handles this disposed.
let bound = false;
function sweepOnSignal(): void {
  if (bound) return;
  bound = true;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      void Promise.allSettled([...live].map((dispose) => dispose())).then(() => process.exit(130));
    });
  }
}

/** The wrangler config a test database runs under: one `DB` binding and nothing else. @internal */
export function testD1Config(): string {
  return `${JSON.stringify(
    {
      name: "forge-test-d1",
      compatibility_date: "2026-01-01",
      d1_databases: [{ binding: "DB", database_name: "forge-test-d1", database_id: "forge-test-d1" }],
    },
    null,
    2,
  )}\n`;
}

/** The statements that empty a database of every app object: triggers, views and indexes, then each table before any table it references. @internal */
export function dropStatements(objects: readonly { type: string; name: string }[], parents: ReadonlyMap<string, readonly string[]>): string[] {
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const of = (type: string) => objects.filter((object) => object.type === type).map((object) => object.name);
  const drops = [
    ...of("trigger").map((name) => `DROP TRIGGER IF EXISTS ${quote(name)}`),
    ...of("view").map((name) => `DROP VIEW IF EXISTS ${quote(name)}`),
    ...of("index").map((name) => `DROP INDEX IF EXISTS ${quote(name)}`),
  ];
  const remaining = new Set(of("table"));
  while (remaining.size > 0) {
    const referenced = new Set([...remaining].flatMap((table) => (parents.get(table) ?? []).filter((parent) => parent !== table)));
    const leaves = [...remaining].filter((table) => !referenced.has(table)).sort();
    // A cycle has no leaf; the batch defers foreign keys, so name order is safe for what is left.
    const next = leaves.length > 0 ? leaves : [...remaining].sort();
    for (const table of next) {
      drops.push(`DROP TABLE IF EXISTS ${quote(table)}`);
      remaining.delete(table);
    }
  }
  return drops;
}

/** Opens a private local D1 on wrangler's engine and applies every migration in wrangler's order. @public */
export async function openTestD1(options: OpenTestD1Options = {}): Promise<TestD1> {
  const root = resolve(options.root ?? process.cwd());
  const { hostConfig } = options;
  const host =
    options.migrations === undefined ? await loadHostConfig(root, hostConfig ?? DEFAULT_DB_CONFIG, hostConfig !== undefined, "`hostConfig`") : {};
  const directory = declaredPath(root, options.migrations ?? host.migrations ?? DB_LAYOUT.migrations).path;
  if (!existsSync(directory)) throw new Error(`openTestD1: no migrations directory at ${directory}`);
  const migrations = inMigrationOrder(
    readdirSync(directory)
      .filter(isMigrationFileName)
      .map((name) => ({ name, sql: readFileSync(join(directory, name), "utf-8") })),
  );

  // A directory per handle: two handles on one persisted file contend for its lock and fail SQLITE_BUSY.
  const home = mkdtempSync(join(tmpdir(), "forge-test-d1-"));
  writeFileSync(join(home, "wrangler.jsonc"), testD1Config());
  const platform = await openPlatformD1(join(home, "wrangler.jsonc"), join(home, "state")).catch((error: unknown) => {
    rmSync(home, { recursive: true, force: true });
    throw error;
  });
  const db = platform.binding;
  const rows = async <T>(sql: string): Promise<T[]> => (await db.prepare(sql).all<T>()).results;

  const migrate = async (): Promise<void> => {
    for (const migration of migrations) {
      const statements = unstable_splitSqlQuery(migration.sql).filter((statement) => statement.trim() !== "");
      if (statements.length === 0) continue;
      await db.batch(statements.map((statement) => db.prepare(statement))).catch((error: unknown) => {
        throw new Error(`openTestD1: ${migration.name} failed to apply: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      });
    }
  };

  const dispose = async (): Promise<void> => {
    await platform.dispose();
    rmSync(home, { recursive: true, force: true });
  };

  try {
    await migrate();
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    binding: db,
    rows,
    async reset() {
      const objects = await rows<{ type: string; name: string }>(INVENTORY_SELECT);
      const parents = new Map<string, string[]>();
      for (const { type, name } of objects) {
        if (type !== "table") continue;
        const keys = await rows<{ table: string }>(`PRAGMA foreign_key_list("${name.replaceAll('"', '""')}")`);
        parents.set(
          name,
          keys.map((key) => key.table),
        );
      }
      const drops = dropStatements(objects, parents);
      if (drops.length > 0) await db.batch(["PRAGMA defer_foreign_keys = true", ...drops].map((statement) => db.prepare(statement)));
      await migrate();
    },
    dispose,
  };
}

/** One row of SQLite's `EXPLAIN QUERY PLAN`: the step, the step it sits under, and what it does. @public */
export interface PlanStep {
  id: number;
  parent: number;
  detail: string;
}

/** Asks the test database how it would run `fragment`, binding its parameters as the client would. @public */
export async function explainPlan(d1: TestD1, fragment: SqlFragment): Promise<PlanStep[]> {
  const res = await d1.binding
    .prepare(`EXPLAIN QUERY PLAN ${fragment.text}`)
    .bind(...fragment.params)
    .all<{ id: number; parent: number; detail: string }>();
  return res.results.map(({ id, parent, detail }) => ({ id, parent, detail }));
}

const quoted = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when some step reaches its rows through the named index. @public */
export function usesIndex(plan: readonly PlanStep[], index: string): boolean {
  const pattern = new RegExp(`\\bUSING (?:COVERING )?INDEX ${quoted(index)}(?:\\s|$)`);
  return plan.some((step) => pattern.test(step.detail));
}

/** True when some step reads every row of a table with no index to narrow it; `name` is what the query calls the table — its alias where it gives one, since the plan names nothing else. @public */
export function scansTable(plan: readonly PlanStep[], name: string): boolean {
  const pattern = new RegExp(`^SCAN ${quoted(name)}$`);
  return plan.some((step) => pattern.test(step.detail));
}
