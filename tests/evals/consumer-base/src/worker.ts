import { applyMiddlewareChain, createApp } from "@y-core/forge/app";
import type { SecurityHeadersOptions } from "@y-core/forge/security";

import { appConfig } from "./app/config";
import { EnvSchema } from "./app/env.schema";
import type { Bindings } from "./app/types";
import { registerRoutes } from "./router";

const securityHeaders: SecurityHeadersOptions = { scriptSrc: ["'self'"] };

export function createWorker(security: SecurityHeadersOptions) {
  return createApp<Bindings>({
    config: appConfig,
    middleware: (app) => applyMiddlewareChain(app, { securityHeaders: security, bindings: EnvSchema }),
    routes: registerRoutes,
  });
}

export default createWorker(securityHeaders);
