import { registerConfig } from "../config/registry";
import { applyAssets } from "./assets";
import { Forge } from "./forge-app";
import type { AppOptions, HasAssets } from "./types";

/**
 * Creates a Forge app with a structured error boundary, optionally performing the full
 * bootstrap wiring in the enforced canonical order: `middleware` → `routes` → `finalize`
 * → `assets` (the static-asset catch-all is always registered last, so real routes win).
 *
 * @example
 * ```typescript
 * export default createApp<Bindings>({
 *   config: configStore,
 *   isDebug: (c) => configStore.get(c.env).site.debug,
 *   middleware: (app) => applyMiddlewareChain(app, { securityHeaders, bindings: EnvSchema }),
 *   routes: registerRoutes,
 *   assets: { notFoundView: notFoundController },
 * });
 * ```
 * @public
 */
export function createApp<Bindings extends object = Record<string, unknown>>(options?: AppOptions<Bindings>): Forge<Bindings> {
  const app = new Forge<Bindings>(options?.logger);

  if (options?.config) {
    registerConfig(app, options.config);
    // biome-ignore lint/suspicious/noExplicitAny: Config<T> is generic; stored as unknown internally
    app.configStore = options.config as any;
  }
  if (options?.onError) {
    app.setOnError(options.onError);
  }
  if (options?.isDebug) {
    app.setIsDebug(options.isDebug);
  }

  // Ordered wiring: middleware before routes (guards wrap handlers), assets strictly last
  // (a catch-all registered earlier would shadow every route added after it).
  options?.middleware?.(app);
  options?.routes?.(app);
  options?.finalize?.(app);
  if (options?.assets) {
    // ASSETS is an optional binding — any Bindings shape satisfies HasAssets at runtime; the
    // cast only widens the compile-time constraint applyAssets declares.
    applyAssets(app as Forge<Bindings & HasAssets>, options.assets);
  }

  return app;
}
