import type { RequestHandler } from "@remix-run/fetch-router";
import { createController } from "@remix-run/fetch-router";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";
import { resolveConfig } from "../config/config";
import { retrieveConfig } from "../config/registry";
import { getAppContext } from "../context/types";
import type { Forge } from "./forge-app";
import type { AssetOptions, HasAssets } from "./types";

/** Registers the static-asset catch-all handler onto a Forge app. @public */
export function applyAssets<Bindings extends HasAssets = HasAssets>(app: Forge<Bindings>, options: AssetOptions<Bindings>, path = "*"): void {
  // A `Route` instance (rather than a `{ method, pattern }` literal) is required so the catch-all
  // `"ANY"` method is preserved — the object form's `method` field excludes `"ANY"`.
  const routes = createRoutes({ assets: new Route("ANY", path) });
  app.map(routes, createController(routes, { actions: { assets: serveAssets(app, options) } }));
}

/** Route handler that serves static assets from the `ASSETS` binding, falling back to `notFoundView`. */
export function serveAssets<Bindings extends HasAssets = HasAssets>(app: Forge<Bindings>, options: AssetOptions<Bindings>): RequestHandler {
  return async (context) => {
    const c = getAppContext<Bindings>(context);
    const configStore = retrieveConfig(app);
    const config = resolveConfig(configStore, c.env);
    const assets = c.env.ASSETS;

    if (!assets) {
      return options.notFoundView(c, config);
    }

    if (context.method !== "GET" && context.method !== "HEAD") {
      return options.notFoundView(c, config);
    }

    const res = await assets.fetch(context.request);

    if (res.status === 404) {
      return options.notFoundView(c, config);
    }

    return new Response(res.body, res);
  };
}
