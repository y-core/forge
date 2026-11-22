import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { getPlatformProxy } from "wrangler";

import type { D1Database } from "../../storage/db/types";
import { applyTestMigrations, dropAppObjects, readTestMigrations } from "./migrations";
import type { OpenTestD1Options, PlanStep, PlatformD1, TestD1 } from "./types";

export type { OpenTestD1Options, PlanStep, PlatformD1, TestD1 } from "./types";

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

/** Opens a private local D1 on wrangler's engine and applies every migration in wrangler's order. @public */
export async function openTestD1(options: OpenTestD1Options = {}): Promise<TestD1> {
  const migrations = await readTestMigrations(options, "openTestD1");

  // A directory per handle: two handles on one persisted file contend for its lock and fail SQLITE_BUSY.
  const home = mkdtempSync(join(tmpdir(), "forge-test-d1-"));
  writeFileSync(join(home, "wrangler.jsonc"), testD1Config());
  const platform = await openPlatformD1(join(home, "wrangler.jsonc"), join(home, "state")).catch((error: unknown) => {
    rmSync(home, { recursive: true, force: true });
    throw error;
  });
  const db = platform.binding;

  const dispose = async (): Promise<void> => {
    await platform.dispose();
    rmSync(home, { recursive: true, force: true });
  };

  try {
    await applyTestMigrations(db, migrations, "openTestD1");
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    binding: db,
    rows: async <T>(query: string): Promise<T[]> => (await db.prepare(query).all<T>()).results,
    async reset() {
      await dropAppObjects(db);
      await applyTestMigrations(db, migrations, "openTestD1");
    },
    dispose,
  };
}

/** Asks the test database how it would run `query`, binding `params` as the client would. @public */
export async function explainPlan(d1: TestD1, query: string, params: readonly unknown[] = []): Promise<PlanStep[]> {
  const res = await d1.binding
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .bind(...params)
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
