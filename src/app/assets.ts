import type { Context, Env, Hono } from "hono";
import type { InferConfig } from "../config/config";
import { resolveConfig } from "../config/config";
import { retrieveConfig } from "../config/registry";
import type { AssetOptions, AssetsFetcher } from "./types";

type HasAssets = { Bindings: { ASSETS?: AssetsFetcher } };

/** Registers the static-asset catch-all handler onto a Hono app. @public */
export function applyAssets<E extends Env & HasAssets>(app: Hono<E>, options: AssetOptions<E>, path = "*"): void {
  app.all(path, serveAssets(app, options));
}

/** Route handler that serves static assets from the `ASSETS` binding, falling back to `notFoundView`. */
export function serveAssets<E extends Env & HasAssets>(app: Hono<E>, options: AssetOptions<E>) {
  return async (c: Context<E>): Promise<Response> => {
    const configStore = retrieveConfig<InferConfig<E>>(app);
    const config = resolveConfig(configStore, c.env);
    const assets = c.env.ASSETS;

    if (!assets) {
      return options.notFoundView(c, config);
    }

    if (c.req.raw.method !== "GET" && c.req.raw.method !== "HEAD") {
      return options.notFoundView(c, config);
    }

    const res = await assets.fetch(c.req.raw);

    if (res.status === 404) {
      return options.notFoundView(c, config);
    }

    return new Response(res.body, res);
  };
}
