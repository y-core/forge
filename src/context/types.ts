export type { Middleware, RequestHandler } from "@remix-run/fetch-router";
export { createContextKey, RequestContext } from "@remix-run/fetch-router";

import type { RequestContext } from "@remix-run/fetch-router";
import { createContextKey } from "@remix-run/fetch-router";

/** A type-safe accessor pair bound to one context-variable key. @public */
export interface ContextVar<T> {
  /** Reads the variable; throws if it is not set on this request. */
  // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for context-variable access
  get(c: RequestContext<any, any>, message?: string): T;
  // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for context-variable access
  set(c: RequestContext<any, any>, value: T): void;
  /** Reads the variable; `undefined` if not yet set. */
  // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for context-variable access
  getOptional(c: RequestContext<any, any>): T | undefined;
  readonly key: ContextKey<T>;
}

/** Opaque key type for context-variable storage. @public */
export interface ContextKey<T> {
  readonly defaultValue?: T;
}

/** Context key that provides the raw Workers `env` bindings. @internal */
export const EnvKey = createContextKey<unknown>();
/** Context key that provides the Workers `ExecutionContext`. @internal */
export const ExecutionContextKey = createContextKey<ExecutionContext>();
/** Context key that stores the resolved app config for this request. @public */
export const ConfigKey = createContextKey<unknown>();

/** Extends `RequestContext` with Workers-specific `env`, `executionCtx`, and `config` properties. @public */
export type AppContext<
  Bindings = Record<string, unknown>,
  Params extends Record<string, string> = Record<string, string>,
  Config = unknown,
> = RequestContext<Params> & { readonly env: Bindings; readonly executionCtx: ExecutionContext; readonly config: Config };

/** Narrows a `RequestContext` to an `AppContext`, throwing if per-request state has not been injected. @public */
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
