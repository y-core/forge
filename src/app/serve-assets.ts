import type { Context, Env } from "hono";
import type { AssetOptions, AssetsFetcher } from "./types";

type HasAssets = { Bindings: { ASSETS?: AssetsFetcher } };

/** Route handler that serves static assets from the `ASSETS` binding, falling back to `notFoundView`. @public */
export function serveAssets<E extends Env & HasAssets>(options: AssetOptions<E>) {
  return async (c: Context<E>): Promise<Response> => {
    const assets = c.env.ASSETS;

    if (!assets) {
      return options.notFoundView(c);
    }

    if (c.req.raw.method !== "GET" && c.req.raw.method !== "HEAD") {
      return options.notFoundView(c);
    }

    const res = await assets.fetch(c.req.raw);

    if (res.status === 404) {
      return options.notFoundView(c);
    }

    return new Response(res.body, res);
  };
}
