import { registerConfig } from "../config/registry";
import { applyAssets } from "./assets";
import { Forge } from "./forge-app";
import type { AppOptions, HasAssets } from "./types";

/** Creates a Forge app with a structured error boundary, wiring `middleware` → `routes` → `finalize` → `assets` in that order. @public */
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

  // Assets must be strictly last: a catch-all registered earlier shadows every route added after it.
  options?.middleware?.(app);
  options?.routes?.(app);
  options?.finalize?.(app);
  if (options?.assets) {
    applyAssets(app as Forge<Bindings & HasAssets>, options.assets);
  }

  return app;
}
