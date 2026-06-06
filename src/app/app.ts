import { registerConfig } from "../config/registry";
import { Forge } from "./forge-app";
import type { AppOptions } from "./types";

/** Creates a Forge app with a structured error boundary. @public */
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

  return app;
}
