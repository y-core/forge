export type { Middleware, RequestHandler } from "@remix-run/fetch-router";
export { createContextKey, RequestContext } from "@remix-run/fetch-router";

import type { RequestContext } from "@remix-run/fetch-router";
import { createContextKey } from "@remix-run/fetch-router";

/** A type-safe accessor pair bound to one context-variable key. @public */
export interface ContextVar<T> {
  /** Reads the variable; throws if no middleware has set it on this request.
   *  `message` overrides the default error. */
  // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for context-variable access
  get(c: RequestContext<any, any>, message?: string): T;
  /** Sets the variable for this request. */
  // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for context-variable access
  set(c: RequestContext<any, any>, value: T): void;
  /** Reads the variable; `undefined` if not yet set. */
  // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for context-variable access
  getOptional(c: RequestContext<any, any>): T | undefined;
  /** The underlying typed key. */
  readonly key: ContextKey<T>;
}

/**
 * Opaque key type for context-variable storage.
 * Structurally compatible with fetch-router's internal ContextKey<T>. @public
 */
export interface ContextKey<T> {
  readonly defaultValue?: T;
}

/** Context key that provides the raw Workers `env` bindings. @internal */
export const EnvKey = createContextKey<unknown>();
/** Context key that provides the Workers `ExecutionContext`. @internal */
export const ExecutionContextKey = createContextKey<ExecutionContext>();
/** Context key that stores the resolved app config for this request. @public */
export const ConfigKey = createContextKey<unknown>();

/** Extends `RequestContext` with Workers-specific `env`, `executionCtx`, and `config` properties.
 *  Available on any context once the app router has injected per-request state. @public */
export type AppContext<
  Bindings = Record<string, unknown>,
  Params extends Record<string, string> = Record<string, string>,
  Config = unknown,
> = RequestContext<Params> & { readonly env: Bindings; readonly executionCtx: ExecutionContext; readonly config: Config };

/**
 * Narrows a `RequestContext` to an `AppContext`, asserting that the Forge router has already
 * injected per-request state (`env`, `executionCtx`, `config`) via `provideRequestState`.
 *
 * This is the single, named seam for the `RequestContext → AppContext` cast that the type system
 * cannot prove. Reading `EnvKey` lets it fail loudly with a clear message if state is absent —
 * e.g. the handler ran outside the Forge chain — instead of silently yielding `undefined env` that
 * surfaces as a spooky error deep in downstream code. @public
 */
export function getAppContext<Bindings = Record<string, unknown>, Params extends Record<string, string> = Record<string, string>, Config = unknown>(
  // biome-ignore lint/suspicious/noExplicitAny: bindings/params/config are irrelevant for the state check
  context: RequestContext<any, any>,
): AppContext<Bindings, Params, Config> {
  if (context.get(EnvKey) === undefined) {
    throw new Error(
      "getAppContext: per-request state is not available — the Forge router must inject request state (provideRequestState) before this handler runs.",
    );
  }
  return context as unknown as AppContext<Bindings, Params, Config>;
}
