/**
 * Per-request context variables and shared app context types for `@y-core/forge/context`. @public
 *
 * Exports `contextVar` (typed accessor factory), `AppContext` (Workers-aware context type),
 * `RequestContext` (fetch-router base), and related middleware/handler types.
 */
export { contextVar } from "./accessor";
export type { AppContext, ContextKey, ContextVar, Middleware, RequestHandler } from "./types";
export { createContextKey, EnvKey, ExecutionContextKey, getAppContext, RequestContext } from "./types";
