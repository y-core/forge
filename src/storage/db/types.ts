import type { AppContext } from "../../context/types";
import type { Logger } from "../../logging/types";
import type { Result } from "../../result/result";

/**
 * A parameterised SQL fragment — values are bind params, never concatenated text.
 * Compose fragments with nested interpolation; they flatten automatically. @public
 */
export interface SqlFragment {
  readonly text: string;
  readonly params: readonly unknown[];
}

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

/** Options for resolving a D1 binding from context. @public */
export interface D1BindingOptions<Bindings = Record<string, unknown>> {
  binding: (c: AppContext<Bindings>) => D1Database | undefined;
  /** When true (default), throws if the binding is absent. Set false to return null instead. */
  required?: boolean;
  client?: D1ClientOptions;
}

/** Minimal structural D1Database — type-only, erases at runtime. @public */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

/** @public */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  run(): Promise<D1Result<unknown>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

/** @public */
export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { duration?: number; last_row_id?: number | null; changes?: number; rows_written?: number; rows_read?: number };
}
