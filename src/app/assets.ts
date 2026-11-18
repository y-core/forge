import type { RequestHandler } from "@remix-run/fetch-router";

import { getAppContext } from "../context/types";
import type { Forge } from "./forge-app";
import type { HasAssets } from "./types";

/** Registers the static-asset catch-all handler onto a Forge app, which must be the last registration. @public */
export function applyAssets<Bindings extends HasAssets = HasAssets>(app: Forge<Bindings>, path = "*"): void {
  app.map(path, serveAssets(app));
}

/** Route handler that serves static assets from the `ASSETS` binding, falling back to the app's not-found answer. */
export function serveAssets<Bindings extends HasAssets = HasAssets>(app: Forge<Bindings>): RequestHandler {
  return async (context) => {
    const c = getAppContext<Bindings>(context);
    const assets = c.env.ASSETS;

    if (!assets) {
      return app.notFound(c, c.config);
    }

    if (context.method !== "GET" && context.method !== "HEAD") {
      return app.notFound(c, c.config);
    }

    const res = await assets.fetch(context.request);

    if (res.status === 404) {
      return app.notFound(c, c.config);
    }

    return new Response(res.body, res);
  };
}
