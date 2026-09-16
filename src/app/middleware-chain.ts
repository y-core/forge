import type { Middleware } from "@remix-run/fetch-router";

import { validateBindings } from "../context/env-validation";
import { requestLogger } from "../logging/request-logger";
import { originProtection } from "../security/cop";
import { createSecurityHeaders } from "../security/headers";
import { rateLimit } from "../security/rate-limit";
import { requestId } from "../security/request-id";
import type { Forge } from "./forge-app";
import type { MiddlewareChainOptions, MiddlewareGuardGroup } from "./types";

/** Expands one guard group into the ordered chain `app.use` takes: origin protection, then rate limit, then the group's own guards. @public */
export function buildGuardChain<Bindings extends object = Record<string, unknown>>(
  group: MiddlewareGuardGroup<Bindings>,
  options: { trustCfHeaders?: boolean } = {},
): Middleware[] {
  const trustCfHeaders = options.trustCfHeaders === true;
  return [
    ...(group.origin ? [originProtection<Bindings>(group.origin)] : []),
    ...(group.rateLimit ? [rateLimit<Bindings>({ trustCfHeaders, ...group.rateLimit })] : []),
    ...(group.guards ?? []),
  ];
}

/** Registers the canonical forge middleware chain on `app`, encoding its load-bearing order once. @public */
export function applyMiddlewareChain<Bindings extends object = Record<string, unknown>>(
  app: Forge<Bindings>,
  options: MiddlewareChainOptions<Bindings>,
): void {
  const trustCfHeaders = options.trustCfHeaders === true;
  if (options.before?.length) app.use("*", ...options.before);
  if (options.requestId !== false) app.use("*", requestId({ trustCfHeaders }));
  if (options.logging) app.use("*", requestLogger<Bindings>(options.logging));
  app.use("*", createSecurityHeaders(options.securityHeaders));
  if (options.bindings) app.use("*", validateBindings(options.bindings));
  if (options.session) app.use("*", options.session);
  if (options.globals?.length) app.use("*", ...options.globals);

  for (const group of options.guards ?? []) app.use(group.paths, ...buildGuardChain(group, { trustCfHeaders }));
}
