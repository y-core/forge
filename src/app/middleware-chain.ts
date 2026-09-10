import { validateBindings } from "../context/env-validation";
import { requestLogger } from "../logging/request-logger";
import { originProtection } from "../security/cop";
import { createSecurityHeaders } from "../security/headers";
import { rateLimit } from "../security/rate-limit";
import { requestId } from "../security/request-id";
import type { Forge } from "./forge-app";
import type { MiddlewareChainOptions } from "./types";

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
    if (group.origin) app.use(group.paths, originProtection<Bindings>(group.origin));
    if (group.rateLimit) app.use(group.paths, rateLimit<Bindings>({ trustCfHeaders, ...group.rateLimit }));
    if (group.middleware) app.use(group.paths, ...group.middleware);
  }
}
