import type { Middleware } from "@remix-run/fetch-router";

import type { AppContext, BindingSpec } from "../../context/types";
import type { Logger } from "../../logging/types";
import type { Result } from "../../result/types";
import type { D1Failure } from "./failure";
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
  retry?: Partial<D1RetryPolicy>;
  /** A call whose D1-reported duration exceeds this logs its `d1.query` record at `warn` instead of `debug`. */
  slowQueryMs?: number;
}

/** How often an idempotent call is tried on a transient failure, and the base and cap of the jittered wait. @public */
export interface D1RetryPolicy {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

/** What a caller of `D1Client` branches on: `transient` alone is ever retried. @public */
export type D1FailureKind = "constraint" | "transient" | "overloaded" | "limit" | "timeout" | "guard" | "unavailable";

/** @public */
export type D1ConstraintRule = "unique" | "not-null" | "check" | "foreign-key";

/** The constraint a write broke, and its name where D1 gives one — a column, an index or a CHECK expression. @public */
export interface D1Constraint {
  readonly rule: D1ConstraintRule;
  readonly name: string | null;
}

/** What D1 bills a call on, summed over its statements: `rowsWritten` here is D1's I/O count, index rows included, not the change count. @public */
export interface D1Cost {
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly durationMs: number;
}

/** Where D1 ran a call: the region of the instance that answered, and whether that instance was the primary rather than a read replica. @public */
export interface D1ServedBy {
  readonly region: string | null;
  readonly primary: boolean | null;
}

/** How a `D1Client` call went beyond its answer: the dispatches it took, D1's own read retries included, and, where D1 reported them, its cost and placement. @public */
export interface D1CallMeta {
  readonly attempts: number;
  readonly cost?: D1Cost;
  readonly servedBy?: D1ServedBy;
}

/** A `D1Client` answer: a `Result` failing with a classified `D1Failure`, and the call's meta on either branch. @public */
export type D1Outcome<T> = Result<T, D1Failure> & { readonly meta: D1CallMeta };

/** Options on a write: `idempotent` says a repeat does no harm, which is what lets a transient failure be retried. @public */
export interface D1WriteOptions {
  idempotent?: true;
}

/** One statement's outcome inside a batch: its rows, and the write count `execute` would report. @public */
export interface D1BatchResult<T = unknown> {
  readonly results: T[];
  readonly rowsWritten: number;
  readonly lastRowId?: number | null;
}

/** A D1 binding that accepts only `sql` fragments and returns every outcome as a `Result`. @public */
export interface D1Client {
  batch<T = unknown>(fragments: SqlFragment[], options?: D1WriteOptions): Promise<D1Outcome<D1BatchResult<T>[]>>;
  execute(fragment: SqlFragment, options?: D1WriteOptions): Promise<D1Outcome<{ rowsWritten: number; lastRowId?: number | null }>>;
  query<T = unknown>(fragment: SqlFragment): Promise<D1Outcome<T[]>>;
  queryOne<T = unknown>(fragment: SqlFragment): Promise<D1Outcome<T | null>>;
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

/** One binding's schema read, reused under the same `env` until `recheckMs` passes; `reuseMismatch` says whether a cached mismatch counts. @internal */
export interface SchemaHealthMemo {
  read(db: D1DatabaseLike, env: unknown, at: number, reuseMismatch: boolean): Promise<SchemaHealth>;
}

/** How long a schema verdict is trusted before it is read again, and the clock that measures it. @public */
export interface SchemaRecheckOptions {
  recheckMs?: number | undefined;
  now?: (() => number) | undefined;
}

/** Options for `schemaHealthMonitor`: where the binding is, and which logger takes the record. @public */
export interface SchemaHealthMonitorOptions<Bindings = Record<string, unknown>> extends SchemaRecheckOptions {
  binding: (c: AppContext<Bindings>) => D1DatabaseLike | undefined;
  logger?: Logger | undefined;
}

/** Options for `defineD1Binding`: the `env` key the database is bound under, and how its client and checks behave. @public */
export interface D1BindingDefinition extends SchemaRecheckOptions {
  name: string;
  logger?: Logger | undefined;
  client?: D1ClientOptions | undefined;
}

/** A D1 binding's pieces, each handed to the seam that mounts it: `spec` to `bindings`, `globals` to `globals`, `health` to `healthCheck`. @public */
export interface D1BindingMount<Bindings = Record<string, unknown>> {
  readonly spec: BindingSpec;
  readonly globals: Middleware[];
  readonly health: Readonly<Record<string, (c: AppContext<Bindings>) => boolean | Promise<boolean>>>;
  client(c: AppContext<Bindings>): D1Client;
}

/** Options for resolving a D1 binding from context. @public */
export interface D1BindingOptions<Bindings = Record<string, unknown>, DB extends D1DatabaseLike = D1Database> {
  binding: (c: AppContext<Bindings>) => DB | undefined;
  required?: boolean;
  client?: D1ClientOptions;
}

/** The part of a D1 binding, or of one of its sessions, a `D1Client` sends statements through. @public */
export interface D1Queryable {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** A D1 session: queries that stay sequentially consistent with each other, and the bookmark that carries that point to a later request. @public */
export interface D1DatabaseSession extends D1Queryable {
  getBookmark(): string | null;
}

/** Where a session starts: on the primary, on any replica, or no earlier than a bookmark a previous session returned. @public */
export type D1SessionConstraint = "first-primary" | "first-unconstrained" | (string & {});

/** Structural contract — the consumed surface of a D1 database binding. @public */
export interface D1DatabaseLike extends D1Queryable {
  exec(query: string): Promise<{ count: number; duration: number }>;
  withSession?(constraint: D1SessionConstraint): D1DatabaseSession;
}

/** Options for `d1Sessions`: where the binding is, and the request header or cookie the bookmark travels in between requests. @public */
export interface D1SessionsOptions<Bindings = Record<string, unknown>> {
  binding: (c: AppContext<Bindings>) => D1DatabaseLike | undefined;
  bookmark?: { header: string } | { cookie: string } | undefined;
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
  meta: {
    duration?: number;
    last_row_id?: number | null;
    changes?: number;
    rows_written?: number;
    rows_read?: number;
    total_attempts?: number;
    served_by_region?: string;
    served_by_primary?: boolean;
  };
}

/** The byte encodings a UUID may arrive in — `readonly number[]` is what D1 returns for a `BLOB` column. @public */
export type UuidByteInput = readonly number[] | Uint8Array | ArrayBuffer;

/** Options for {@link createUuidv7Bytes} and {@link createUuidv7}. @public */
export interface Uuidv7Options {
  now?: () => number;
}
