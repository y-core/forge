import type { D1Database } from "../../storage/db/types";

/** Where `openTestD1` reads the app from; every path is relative to `root`, the current directory where unset. @public */
export interface OpenTestD1Options {
  root?: string;
  /** The `DbHostConfig` module naming the migrations directory; `config/db.config.ts` where unset. */
  hostConfig?: string;
  /** Overrides the migrations directory the host config names. */
  migrations?: string;
}

/** A local D1 database with every migration applied, private to the handle that opened it. @public */
export interface TestD1 {
  binding: D1Database;
  rows<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Drops every object the app made and applies the migrations again, on the same database. */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

/** A `DB` binding over getPlatformProxy, and the workerd process behind it. @internal */
export interface PlatformD1 {
  binding: D1Database;
  dispose(): Promise<void>;
}

/** One row of SQLite's `EXPLAIN QUERY PLAN`: the step, the step it sits under, and what it does. @public */
export interface PlanStep {
  id: number;
  parent: number;
  detail: string;
}
