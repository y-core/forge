import { createLogger } from "../../logging/logger";
import type { Logger } from "../../logging/types";
import type { Result } from "../../result/result";
import { result } from "../../result/result";
import type { SqlFragment } from "./sql";
import type { D1Database, D1Result } from "./types";

/** @public */
export interface D1ClientOptions {
  logger?: Logger;
}

/** @public */
export interface D1Client {
  batch<T = unknown>(fragments: SqlFragment[]): Promise<Result<D1Result<T>[]>>;
  execute(fragment: SqlFragment): Promise<Result<{ rowsWritten: number; lastRowId?: number | null }>>;
  query<T = unknown>(fragment: SqlFragment): Promise<Result<T[]>>;
  queryOne<T = unknown>(fragment: SqlFragment): Promise<Result<T | null>>;
}

/** Creates a D1Client accepting only SqlFragment — raw string SQL is rejected by the type system. @public */
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
        const res = await db.prepare(fragment.text).bind(...fragment.params).run();
        return {
          rowsWritten: res.meta.rows_written ?? res.meta.changes ?? 0,
          lastRowId: res.meta.last_row_id,
        };
      });
    },

    query<T = unknown>(fragment: SqlFragment): Promise<Result<T[]>> {
      return result(async () => {
        logger.debug("d1.query", { sql: fragment.text });
        const res = await db.prepare(fragment.text).bind(...fragment.params).all<T>();
        return res.results;
      });
    },

    queryOne<T = unknown>(fragment: SqlFragment): Promise<Result<T | null>> {
      return result(async () => {
        logger.debug("d1.query", { sql: fragment.text });
        return db.prepare(fragment.text).bind(...fragment.params).first<T>();
      });
    },
  };
}
