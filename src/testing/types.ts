import type { Middleware, RequestContext } from "@remix-run/fetch-router";
import type { RequestHandler } from "@remix-run/fetch-router";
import type { Route } from "@remix-run/fetch-router/routes";

import type { LogChannel, Logger, LogRecord } from "../logging/types";
import type { RouteParams } from "../router/types";
/** One enrolled factor on a `fakeAuthD1` user. @public */
export interface FakeAuthFactor {
  readonly kind: string;
  /** Canonical UUID; defaults to one derived from the row's position. */
  readonly id?: string;
  readonly secret?: Uint8Array | null;
  readonly lastCounter?: number | null;
  /** Consecutive failed verifications standing against this enrolment; defaults to `0`. */
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
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly factors?: readonly FakeAuthFactor[];
}

/** Options for `createTestContext`. @public */
export interface TestContextOptions<Bindings = Record<string, unknown>, ConfigData = unknown> {
  /** Workers bindings exposed as `c.env`; defaults to `{}`. */
  env?: Bindings;
  /** Resolved app config exposed as `c.config` and via `ConfigKey`. */
  config?: ConfigData;
  /** Execution context exposed as `c.executionCtx`; defaults to `mockExecutionContext()`. */
  executionCtx?: ExecutionContext;
  /** Request logger installed on the context; defaults to `nullLogger`. */
  logger?: Logger;
}

/** An `ExecutionContext` paired with the drain that settles the deferred work it retained. @public */
export interface CollectedExecutionContext {
  /** Passed as `app.fetch`'s third argument. */
  executionCtx: ExecutionContext;
  /** The live list of promises `waitUntil` has been handed and `drain` has not yet settled — read it to assert that work was deferred at all. */
  pending: readonly Promise<unknown>[];
  /** Settles every promise handed to `waitUntil` so far, so deferred work is assertable. */
  drain: () => Promise<void>;
}

/** A logger and the channel behind it, with every record either has written. @public */
export interface CapturedLogs {
  logger: Logger;
  channel: LogChannel;
  /** Each record as the channel received it, after redaction. */
  records: readonly LogRecord[];
}

/** Options for `fakeKV`. @public */
export interface FakeKVOptions {
  /** Millisecond clock the expiry of every write is resolved and judged against; defaults to `Date.now`. */
  now?: () => number;
}

/** Options for `fakeCacheStorage`. @public */
export interface FakeCacheStorageOptions {
  /** Answers every request `addAll` makes; omitted, the network is unreachable and `addAll` rejects. */
  fetch?: (request: Request) => Promise<Response>;
  /** Origin a relative cache URL resolves against; defaults to `http://test`, as `buildRequest` does. */
  baseUrl?: string;
}

/** Options for `fakeD1`. @public */
export interface FakeD1Options {
  /** Consulted before every executed statement; returning an `Error` makes that operation reject. */
  failOn?: (sql: string, params: unknown[]) => Error | null;
  /** Rows a `run()` or a batched statement reports written; `null` declines the statement, and an absent answer is zero — what a guarded statement reports when it changes nothing. */
  rowsWritten?: (sql: string, params: unknown[]) => number | null;
}

/** A route action for the test helper, whose context carries the params `P` declares: a bare handler or a `{ middleware, handler }` object. @public */
export type TestAction<P extends string = string> =
  // oxlint-disable-next-line typescript/no-explicit-any -- the method plays no part in the params
  | RequestHandler<RequestContext<RouteParams<Route<any, P>>>>
  // oxlint-disable-next-line typescript/no-explicit-any -- the method plays no part in the params
  | { middleware: readonly Middleware[]; handler: RequestHandler<RequestContext<RouteParams<Route<any, P>>>> };

/** The codes an authenticator app would show either side of one step boundary. @public */
export interface TotpCodes {
  /** The step before the clock reading, which a server's one-step drift window still accepts. */
  previous: string;
  current: string;
}
