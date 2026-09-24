import type { RequestHandler } from "@remix-run/fetch-router";
import { createController } from "@remix-run/fetch-router";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";

import { resolveConfig } from "../config/config";
import { retrieveConfig } from "../config/registry";
import { getAppContext } from "../context/types";
import type { Forge } from "./forge-app";
import type { HasAssets } from "./types";

/** Registers the static-asset catch-all handler onto a Forge app, which must be the last registration. @public */
export function applyAssets<Bindings extends HasAssets = HasAssets>(app: Forge<Bindings>, path = "*"): void {
  // A `Route` instance is required so `"ANY"` survives — the object form's `method` field excludes it.
  const routes = createRoutes({ assets: new Route("ANY", path) });
  app.map(routes, createController(routes, { actions: { assets: serveAssets(app) } }));
}

/** Route handler that serves static assets from the `ASSETS` binding, falling back to the app's not-found answer. */
export function serveAssets<Bindings extends HasAssets = HasAssets>(app: Forge<Bindings>): RequestHandler {
  return async (context) => {
    const c = getAppContext<Bindings>(context);
    const configStore = retrieveConfig(app);
    const config = resolveConfig(configStore, c.env);
    const assets = c.env.ASSETS;

    if (!assets) {
      return app.notFound(c, config);
    }

    if (context.method !== "GET" && context.method !== "HEAD") {
      return app.notFound(c, config);
    }

    const res = await assets.fetch(context.request);

    if (res.status === 404) {
      return app.notFound(c, config);
    }

    return new Response(res.body, res);
  };
}
