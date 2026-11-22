export type { Middleware, RequestHandler } from "@remix-run/fetch-router";
export { createContextKey, RequestContext } from "@remix-run/fetch-router";

import type { RequestContext } from "@remix-run/fetch-router";
import { createContextKey } from "@remix-run/fetch-router";

import { requestScope } from "#request-scope";

/** A type-safe accessor pair bound to one context-variable key. @public */
export interface ContextVar<T> {
  /** Reads the variable; throws if it is not set on this request. */
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
  get(c: RequestContext<any, any>, message?: string): T;
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
  set(c: RequestContext<any, any>, value: T): void;
  /** Reads the variable; `undefined` if not yet set. */
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
  getOptional(c: RequestContext<any, any>): T | undefined;
  readonly key: ContextKey<T>;
}

/** Opaque key type for context-variable storage. @public */
export interface ContextKey<T> {
  readonly defaultValue?: T;
}

/** Reads and writes one key of a request's context; `#request-scope` resolves it, and the node bundle's copy refuses both. @internal */
export interface RequestScope {
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
  read<T>(c: RequestContext<any, any>, key: ContextKey<T>): T | undefined;
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
  write<T>(c: RequestContext<any, any>, key: ContextKey<T>, value: T): void;
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
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  Config = unknown,
> = RequestContext<Params> & { readonly env: Bindings; readonly executionCtx: ExecutionContext; readonly config: Config };

/** Narrows a `RequestContext` to an `AppContext`, throwing if per-request state has not been injected. @public */
export function getAppContext<
  Bindings = Record<string, unknown>,
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
  Config = unknown,
>(
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings/params/config are irrelevant for the state check
  context: RequestContext<any, any>,
): AppContext<Bindings, Params, Config> {
  if (requestScope.read(context, EnvKey) === undefined) {
    throw new Error(
      "getAppContext: per-request state is not available — the Forge router must inject request state (provideRequestState) before this handler runs.",
    );
  }
  return context as unknown as AppContext<Bindings, Params, Config>;
}

/** One binding's declared shape. @public */
export interface BindingSpec {
  /** The key the binding is reached under on `env`. */
  name: string;
  /** Method names the binding must carry; the check is a shape check, not a presence check. */
  methods: readonly string[];
  /** How the binding is named in the failure message — `${name} must be ${label}`. */
  label: string;
  /** An absent binding passes; a present one of the wrong shape still fails. */
  optional?: boolean | undefined;
}

/** Why a chain guard refused a request, narrowed by `guard`; the reason is for the hook and the log, never the client. @public */
export type Refusal =
  | {
      readonly guard: "csrf";
      readonly status: 403;
      readonly reason:
        | "expired"
        | "future-timestamp"
        | "invalid-format"
        | "invalid-signature"
        | "missing-token"
        | "path-mismatch"
        | "subject-mismatch"
        | "unknown-key"
        | "unbound-subject";
    }
  | { readonly guard: "csrf"; readonly status: 413; readonly reason: "too-large" }
  | { readonly guard: "csrf"; readonly status: 400; readonly reason: "unreadable-body" }
  | { readonly guard: "origin"; readonly status: 403; readonly reason: "missing" | "disallowed" | "cross-site" | "same-site" }
  | { readonly guard: "rate-limit"; readonly status: 429; readonly retryAfter?: number }
  | { readonly guard: "rate-limit"; readonly status: 503; readonly reason: "binding-absent" | "key-failed" | "binding-failed" }
  | { readonly guard: "admin"; readonly status: 403 };

/** Answers a refused request in the medium the app chooses, or declines with `undefined` so the next hook out, else forge's default, answers. @public */
export type RefuseHook<Bindings = Record<string, unknown>> = (
  c: AppContext<Bindings>,
  refusal: Refusal,
) => Response | undefined | Promise<Response | undefined>;
