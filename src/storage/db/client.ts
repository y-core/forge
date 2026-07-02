import { createLogger } from "../../logging/logger";
import type { Result } from "../../result/result";
import { result } from "../../result/result";
import type { D1Client, D1ClientOptions, D1Database, D1Result, SqlFragment } from "./types";

/**
 * Creates a D1Client accepting only SqlFragment — raw string SQL is rejected by the type
 * system, so bind parameters are enforced by construction. All operations return
 * `Result<T, E>`; resolution failures throw instead (see `resolveD1Client`).
 *
 * @example
 * ```typescript
 * const db = createD1Client(c.env.DB);
 * const r = await db.query<User>(sql`SELECT * FROM users WHERE id = ${id}`);
 * if (!r.ok) return fragmentResponse(renderError("Lookup failed."), 503);
 * const users = r.value; // User[]
 * ```
 * @public
 */
export function createD1Client(db: D1Database, options?: D1ClientOptions): D1Client {
  const logger = options?.logger ?? createLogger("storage/db");

  return {
    batch<T = unknown>(fragments: SqlFragment[]): Promise<Result<D1Result<T>[]>> {
      return result(async () => {
        logger.debug("d1.batch", { count: fragments.length });
        const statements = fragments.map((f) => db.prepare(f.text).bind(...f.params));
        return db.batch<T>(statements);
      });
    },

    execute(fragment: SqlFragment): Promise<Result<{ rowsWritten: number; lastRowId?: number | null }>> {
      return result(async () => {
        logger.debug("d1.query", { sql: fragment.text });
        const res = await db
          .prepare(fragment.text)
          .bind(...fragment.params)
          .run();
        return {
          rowsWritten: res.meta.rows_written ?? res.meta.changes ?? 0,
          ...(res.meta.last_row_id !== undefined ? { lastRowId: res.meta.last_row_id } : {}),
        };
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
