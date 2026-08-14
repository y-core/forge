import type { Middleware } from "@remix-run/fetch-router";
import { validateBindings } from "../context/env-validation";
import { requestLogger } from "../logging/request-logger";
import type { RequestLoggerOptions } from "../logging/types";
import { originProtection } from "../security/cop";
import { createSecurityHeaders } from "../security/headers";
import { rateLimit } from "../security/rate-limit";
import { requestId } from "../security/request-id";
import type { OriginProtectionOptions, RateLimitOptions, SecurityHeadersOptions } from "../security/types";
import type { v } from "../validation/mod";
import type { Forge } from "./forge-app";

/** One per-path guard group in `MiddlewareChainOptions.guards`. @public */
export interface MiddlewareGuardGroup<Bindings = Record<string, unknown>> {
  /** Path patterns, as accepted by `app.use`, the group applies to. */
  paths: string[];
  /** Origin/Referer verification for state-changing routes. */
  origin?: OriginProtectionOptions<Bindings>;
  /** Cloudflare rate-limit binding enforcement. */
  rateLimit?: RateLimitOptions<Bindings>;
  /** Prebuilt guards, registered after `origin` and `rateLimit`. */
  middleware?: Middleware[];
}

/** Declarative input to `applyMiddlewareChain`. @public */
export interface MiddlewareChainOptions<Bindings = Record<string, unknown>> {
  /** Adds `requestId()` first in the chain. */
  requestId?: boolean;
  /** Trust Cloudflare-injected request headers; only safe when the Worker is known to run behind Cloudflare. */
  trustCfHeaders?: boolean;
  /** Per-request structured logging. */
  logging?: RequestLoggerOptions<Bindings>;
  /** Security-header policy. */
  securityHeaders: SecurityHeadersOptions;
  /** Env schema for `validateBindings`. */
  bindings?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
  /** Prebuilt session middleware. */
  session?: Middleware;
  /** Per-path guard groups, registered after the global chain. */
  guards?: MiddlewareGuardGroup<Bindings>[];
}

/** Registers the canonical forge middleware chain on `app`, encoding its load-bearing order once. @public */
export function applyMiddlewareChain<Bindings extends object = Record<string, unknown>>(
  app: Forge<Bindings>,
  options: MiddlewareChainOptions<Bindings>,
): void {
  const trustCfHeaders = options.trustCfHeaders === true;
  if (options.requestId !== false) app.use("*", requestId({ trustCfHeaders }));
  if (options.logging) app.use("*", requestLogger<Bindings>(options.logging));
  app.use("*", createSecurityHeaders(options.securityHeaders));
  if (options.bindings) app.use("*", validateBindings(options.bindings));
  if (options.session) app.use("*", options.session);

  for (const group of options.guards ?? []) {
    for (const path of group.paths) {
      if (group.origin) app.use(path, originProtection<Bindings>(group.origin));
      if (group.rateLimit) app.use(path, rateLimit<Bindings>({ trustCfHeaders, ...group.rateLimit }));
      if (group.middleware) app.use(path, ...group.middleware);
    }
  }
}
