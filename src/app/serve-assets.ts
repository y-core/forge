import type { Context, Env } from "hono";
import type { AssetOptions } from "./types";

export function serveAssets<E extends Env = Env>(options: AssetOptions<E>) {
  return async (c: Context<E>): Promise<Response> => {
    const assets = (c.env as Record<string, unknown>)?.ASSETS as
      | { fetch: (req: Request) => Promise<Response> }
      | undefined;

    if (!assets) {
      return options.notFoundView(c);
    }

    const res = await assets.fetch(c.req.raw);
    if (res.status === 404) {
      return options.notFoundView(c);
    }
    return new Response(res.body, res);
  };
}
