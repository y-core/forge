import { Database } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";

import type { D1Database, D1PreparedStatement, D1Result } from "../../storage/db/types";
import { cutSqlStatements } from "../../tooling/db/backup/split";
import { applyTestMigrations, dropAppObjects, readTestMigrations } from "./migrations";
import type { OpenTestD1Options, TestD1 } from "./types";

export type { OpenTestD1Options, TestD1 } from "./types";

interface Bound {
  query: string;
  params: readonly unknown[];
}

const COUNTERS = "SELECT total_changes() AS total, last_insert_rowid() AS last_row_id";

// D1 hands a BLOB back as an array of byte values, not a typed array.
const asD1Value = (value: unknown): unknown => (value instanceof Uint8Array ? Array.from(value) : value);

function asD1Row<T>(row: unknown): T {
  if (typeof row !== "object" || row === null) return row as T;
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [column, asD1Value(value)])) as T;
}

function bunD1Binding(sqlite: Database): D1Database {
  const bound = new WeakMap<D1PreparedStatement, Bound>();

  const counters = () => sqlite.query<{ total: number; last_row_id: number }, []>(COUNTERS).get() ?? { total: 0, last_row_id: 0 };

  const execute = <T>({ query, params }: Bound): D1Result<T> => {
    const before = counters().total;
    const results = sqlite
      .query<unknown, SQLQueryBindings[]>(query)
      .all(...(params as SQLQueryBindings[]))
      .map((row) => asD1Row<T>(row));
    const after = counters();
    const changes = after.total - before;
    return {
      results,
      success: true,
      meta: { duration: 0, changes, rows_written: changes, rows_read: results.length, last_row_id: after.last_row_id },
    };
  };

  const statement = (query: string, params: readonly unknown[]): D1PreparedStatement => {
    const prepared: D1PreparedStatement = {
      bind: (...values: unknown[]) => statement(query, values),
      all: async <T>() => execute<T>({ query, params }),
      run: async () => execute<unknown>({ query, params }),
      first: async <T>(column?: string): Promise<T | null> => {
        const row = execute<Record<string, unknown>>({ query, params }).results[0];
        if (row === undefined) return null;
        if (column === undefined) return row as T;
        if (!Object.hasOwn(row, column)) throw new Error(`D1_ERROR: no such column: ${column}`);
        return row[column] as T;
      },
    };
    bound.set(prepared, { query, params });
    return prepared;
  };

  const boundOf = (prepared: D1PreparedStatement): Bound => {
    const found = bound.get(prepared);
    if (found === undefined) throw new TypeError("openBunD1: a batch takes only statements this binding prepared");
    return found;
  };

  return {
    prepare: (query: string) => statement(query, []),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const steps = statements.map(boundOf);
      return sqlite.transaction(() => steps.map((step) => execute<T>(step)))();
    },
    exec: async (query: string) => {
      const statements = cutSqlStatements(query);
      for (const step of statements) sqlite.run(step);
      return { count: statements.length, duration: 0 };
    },
  };
}

/** Opens a private in-memory D1 on `bun:sqlite`, foreign keys enforced, and applies every migration in wrangler's order. @public */
export async function openBunD1(options: OpenTestD1Options = {}): Promise<TestD1> {
  const migrations = await readTestMigrations(options, "openBunD1");
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  const db = bunD1Binding(sqlite);

  try {
    await applyTestMigrations(db, migrations, "openBunD1");
  } catch (error) {
    sqlite.close();
    throw error;
  }

  return {
    binding: db,
    rows: async <T>(query: string): Promise<T[]> => (await db.prepare(query).all<T>()).results,
    async reset() {
      await dropAppObjects(db);
      await applyTestMigrations(db, migrations, "openBunD1");
    },
    dispose: async () => sqlite.close(),
  };
}
