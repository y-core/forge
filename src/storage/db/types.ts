import type { AppContext } from "../../context/types";
import type { Logger } from "../../logging/types";
import type { Result } from "../../result/types";
import type { SQL_FRAGMENT_BRAND } from "./sql";

/** A parameterised SQL fragment — values are bind params, never concatenated text. @public */
export interface SqlFragment {
  /** Provenance brand — set only by `sql()`, unreachable from consumer code. @internal */
  readonly [SQL_FRAGMENT_BRAND]: true;
  readonly text: string;
  readonly params: readonly unknown[];
}

/** @public */
export interface D1ClientOptions {
  logger?: Logger;
}

/** One statement's outcome inside a batch: its rows, and the write count `execute` would report. @public */
export interface D1BatchResult<T = unknown> {
  readonly results: T[];
  readonly rowsWritten: number;
  readonly lastRowId?: number | null;
}

/** A D1 binding that accepts only `sql` fragments and returns every outcome as a `Result`. @public */
export interface D1Client {
  batch<T = unknown>(fragments: SqlFragment[]): Promise<Result<D1BatchResult<T>[]>>;
  execute(fragment: SqlFragment): Promise<Result<{ rowsWritten: number; lastRowId?: number | null }>>;
  query<T = unknown>(fragment: SqlFragment): Promise<Result<T[]>>;
  queryOne<T = unknown>(fragment: SqlFragment): Promise<Result<T | null>>;
}

/** One `sqlite_master` row, as the inventory read returns it. @public */
export interface SchemaObject {
  readonly type: string;
  readonly name: string;
  readonly tblName: string;
  readonly sql: string | null;
}

/** How the schema stands against the fingerprint `forge db migrate` certified; `unavailable` means no `_forge_migrations` table. @public */
export type SchemaHealthState = "match" | "mismatch" | "unrecorded" | "unavailable";

/** The schema health report: the state, and both fingerprints. @public */
export interface SchemaHealth {
  readonly state: SchemaHealthState;
  readonly recorded: string | null;
  readonly actual: string | null;
}

/** Options for `schemaHealthMonitor`: where the binding is, and which logger takes the record. @public */
export interface SchemaHealthMonitorOptions<Bindings = Record<string, unknown>> {
  binding: (c: AppContext<Bindings>) => D1DatabaseLike | undefined;
  logger?: Logger | undefined;
}

/** Options for resolving a D1 binding from context. @public */
export interface D1BindingOptions<Bindings = Record<string, unknown>, DB extends D1DatabaseLike = D1Database> {
  binding: (c: AppContext<Bindings>) => DB | undefined;
  required?: boolean;
  client?: D1ClientOptions;
}

/** Structural contract — the consumed surface of a D1 database binding. @public */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

/** Minimal structural D1Database — type-only, erases at runtime. @public */
export interface D1Database extends D1DatabaseLike {}

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
