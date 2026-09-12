import { createLogger } from "../../logging/logger";
import { result } from "../../result/result";
import type { Result } from "../../result/types";
import { ROWS_WRITTEN_GUARD } from "./sql";
import type { D1BatchResult, D1Client, D1ClientOptions, D1Database, D1Result, SqlFragment } from "./types";

const ROWS_WRITTEN_GUARD_ERROR = /integer overflow/i;

/** The overflow a `requireRowsWritten()` guard raised, reworded; any other failure passes through unchanged. */
function batchFailure(thrown: unknown, fragments: SqlFragment[]): unknown {
  const guarded = fragments.some((f) => f.text.includes(ROWS_WRITTEN_GUARD));
  if (!guarded || !(thrown instanceof Error) || !ROWS_WRITTEN_GUARD_ERROR.test(thrown.message)) return thrown;
  return new Error("a guarded statement in this batch wrote no row, so the batch was rolled back", { cause: thrown });
}

// `changes` first: it is the exact "did my write match a row" signal every guard rests on, and the
// one `ROWS_WRITTEN_GUARD` is built from. `rows_written` is an IO metric that counts index rows too.
/** The write count and last row id a D1 result carries, under the names forge reports. */
function writtenOf(meta: D1Result["meta"]): { rowsWritten: number; lastRowId?: number | null } {
  return { rowsWritten: meta.changes ?? meta.rows_written ?? 0, ...(meta.last_row_id !== undefined ? { lastRowId: meta.last_row_id } : {}) };
}

/** Creates a D1Client accepting only SqlFragment — raw string SQL is rejected by the type system, so bind parameters are enforced by construction. @public */
export function createD1Client(db: D1Database, options?: D1ClientOptions): D1Client {
  const logger = options?.logger ?? createLogger("storage/db");

  return {
    batch<T = unknown>(fragments: SqlFragment[]): Promise<Result<D1BatchResult<T>[]>> {
      return result(async () => {
        logger.debug("d1.batch", { count: fragments.length });
        const statements = fragments.map((f) => db.prepare(f.text).bind(...f.params));
        const outcomes = await db.batch<T>(statements).catch((thrown: unknown) => {
          throw batchFailure(thrown, fragments);
        });
        return outcomes.map((res) => ({ results: res.results, ...writtenOf(res.meta) }));
      });
    },

    execute(fragment: SqlFragment): Promise<Result<{ rowsWritten: number; lastRowId?: number | null }>> {
      return result(async () => {
        logger.debug("d1.query", { sql: fragment.text });
        const res = await db
          .prepare(fragment.text)
          .bind(...fragment.params)
          .run();
        return writtenOf(res.meta);
      });
    },

    query<T = unknown>(fragment: SqlFragment): Promise<Result<T[]>> {
      return result(async () => {
        logger.debug("d1.query", { sql: fragment.text });
        const res = await db
          .prepare(fragment.text)
          .bind(...fragment.params)
          .all<T>();
        return res.results;
      });
    },

    queryOne<T = unknown>(fragment: SqlFragment): Promise<Result<T | null>> {
      return result(async () => {
        logger.debug("d1.query", { sql: fragment.text });
        return db
          .prepare(fragment.text)
          .bind(...fragment.params)
          .first<T>();
      });
    },
  };
}
