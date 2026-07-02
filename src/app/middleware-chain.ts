import type { Middleware } from "@remix-run/fetch-router";
import { requestLogger } from "../logging/request-logger";
import type { RequestLoggerOptions } from "../logging/types";
import { originProtection } from "../security/cop";
import { createSecurityHeaders } from "../security/headers";
import { rateLimit } from "../security/rate-limit";
import { requestId } from "../security/request-id";
import type { OriginProtectionOptions, RateLimitOptions, SecurityHeadersOptions } from "../security/types";
import type { v } from "../validation/mod";
import { validateBindings } from "./env";
import type { Forge } from "./forge-app";

/** One per-path guard group in `MiddlewareChainOptions.guards`. @public */
export interface MiddlewareGuardGroup<Bindings = Record<string, unknown>> {
  /** Path patterns (as accepted by `app.use`) the group applies to, e.g. `["/api/save", "/api/settings"]`. */
  paths: string[];
  /** Origin/Referer verification for state-changing routes. */
  origin?: OriginProtectionOptions<Bindings>;
  /** Cloudflare rate-limit binding enforcement. */
  rateLimit?: RateLimitOptions<Bindings>;
  /** Escape hatch for prebuilt guards (CSRF, CORS, …) — registered after `origin` and `rateLimit`. */
  middleware?: Middleware[];
}

/** Declarative input to `applyMiddlewareChain`. @public */
export interface MiddlewareChainOptions<Bindings = Record<string, unknown>> {
  /** Adds `requestId()` first in the chain. @defaultValue true */
  requestId?: boolean;
  /** Per-request structured logging; omitted = no request logger. */
  logging?: RequestLoggerOptions<Bindings>;
  /** Security-header policy — required; the chain exists to make the safe order the easy order. */
  securityHeaders: SecurityHeadersOptions;
  /** Env schema for `validateBindings` (validated on first request / env change). */
  bindings?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
  /** Prebuilt session middleware (e.g. from `sessionMiddleware`); forge does not construct it here. */
  session?: Middleware;
  /** Per-path guard groups, registered after the global chain. */
  guards?: MiddlewareGuardGroup<Bindings>[];
}

/**
 * Registers the canonical forge middleware chain on `app`, encoding the load-bearing order once:
 *
 * 1. `requestId()` — tracing id available to everything downstream
 * 2. `requestLogger(logging)` — per-request logger (can bind the request id)
 * 3. `createSecurityHeaders(securityHeaders)` — per-request CSP nonce set before any handler renders
 * 4. `validateBindings(bindings)` — env contract enforced before anything reads bindings
 * 5. `session` — session state available to route guards and handlers
 * 6. per-path guards — `origin` → `rateLimit` → `middleware[]` for each group
 *
 * Every slot except `securityHeaders` is optional; omitted slots are skipped without disturbing
 * the relative order of the rest.
 *
 * @example
 * ```typescript
 * applyMiddlewareChain(app, {
 *   logging: { channels: (c) => [consoleChannel()] },
 *   securityHeaders: { scriptSrc: ["'self'", NONCE] },
 *   bindings: EnvSchema,
 *   session: appSessionMiddleware,
 *   guards: [{
 *     paths: ["/api/save", "/api/settings"],
 *     origin: { allowedOrigins: (c) => config.get(c.env).site.url.allowedOrigins },
 *     rateLimit: { limiter: (c) => c.env.RATE_LIMITER, required: false },
 *   }],
 * });
 * ```
 * @public
 */
export function applyMiddlewareChain<Bindings extends object = Record<string, unknown>>(
  app: Forge<Bindings>,
  options: MiddlewareChainOptions<Bindings>,
): void {
  if (options.requestId !== false) app.use("*", requestId());
  if (options.logging) app.use("*", requestLogger<Bindings>(options.logging));
  app.use("*", createSecurityHeaders(options.securityHeaders));
  if (options.bindings) app.use("*", validateBindings(options.bindings));
  if (options.session) app.use("*", options.session);

  for (const group of options.guards ?? []) {
    for (const path of group.paths) {
      if (group.origin) app.use(path, originProtection<Bindings>(group.origin));
      if (group.rateLimit) app.use(path, rateLimit<Bindings>(group.rateLimit));
      if (group.middleware) app.use(path, ...group.middleware);
    }
  }
}
