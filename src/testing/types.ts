import type { Middleware } from "@remix-run/fetch-router";
import type { RequestHandler } from "@remix-run/fetch-router";

import type { Logger } from "../logging/types";
/** One enrolled factor on a `fakeAuthD1` user. @public */
export interface FakeAuthFactor {
  readonly kind: string;
  /** Canonical UUID; defaults to one derived from the row's position. */
  readonly id?: string;
  readonly secret?: Uint8Array | null;
  readonly lastCounter?: number | null;
  /** Consecutive failed verifications standing against this enrolment. @defaultValue `0` */
  readonly failedAttempts?: number;
  /** `null` leaves the enrolment unconfirmed — what a factor begun but never completed looks like. */
  readonly confirmedAt?: number | null;
}

/** One account `fakeAuthD1` answers the auth stores with. @public */
export interface FakeAuthUser {
  /** Canonical UUID — the store binds it as the 16 `BLOB` bytes, which this does for you. */
  readonly id: string;
  readonly email: string;
  /** Defaults to `email` lowercased, which is what the flows write. */
  readonly emailKey?: string;
  readonly emailVerifiedAt?: number | null;
  readonly webauthnId?: Uint8Array | null;
  readonly isAdmin?: boolean;
  readonly deactivatedAt?: number | null;
  /** The revocation barrier — every session established at or before it is refused. @defaultValue `null` */
  readonly sessionsInvalidBefore?: number | null;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly factors?: readonly FakeAuthFactor[];
}

/** Options for `createTestContext`. @public */
export interface TestContextOptions<Bindings = Record<string, unknown>, ConfigData = unknown> {
  /** Workers bindings exposed as `c.env`. @defaultValue `{}` */
  env?: Bindings;
  /** Resolved app config exposed as `c.config` and via `ConfigKey`. */
  config?: ConfigData;
  /** Execution context exposed as `c.executionCtx`. @defaultValue `mockExecutionContext()` */
  executionCtx?: ExecutionContext;
  /** Request logger installed on the context. @defaultValue `nullLogger` */
  logger?: Logger;
}

/** Options for `fakeKV`. @public */
export interface FakeKVOptions {
  /** Millisecond clock the expiry of every write is resolved and judged against; defaults to `Date.now`. */
  now?: () => number;
}

/** Options for `fakeD1`. @public */
export interface FakeD1Options {
  /** Consulted before every executed statement; returning an `Error` makes that operation reject. */
  failOn?: (sql: string, params: unknown[]) => Error | null;
  /** Rows a `run()` or a batched statement reports written; `null` declines the statement, and an absent answer is zero — what a guarded statement reports when it changes nothing. */
  rowsWritten?: (sql: string, params: unknown[]) => number | null;
}

/** A route action for the test helper: a bare handler or a `{ middleware, handler }` object. @public */
export type TestAction = RequestHandler | { middleware: readonly Middleware[]; handler: RequestHandler };
