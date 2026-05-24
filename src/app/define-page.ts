import { CacheControl } from "@remix-run/headers";
import type { Env } from "hono";
import { toArray } from "../router/register";
import type { RouteModule } from "../router/types";
import type { PageDefinition } from "./types";

/** Wraps a view function with optional caching, custom headers, middleware, and error recovery. @public */
export function definePage<E extends Env = Env>(def: PageDefinition<E>): RouteModule<E> {
  const middleware = def.middleware ? toArray(def.middleware) : [];

  return {
    middleware: middleware.length > 0 ? middleware : undefined,
    view: async (c) => {
      if (def.cache === "no-store") {
        c.header("cache-control", new CacheControl({ noStore: true }).toString());
      } else if (def.cache && typeof def.cache === "object") {
        const scope = def.cache.scope ?? "public";
        c.header(
          "cache-control",
          new CacheControl({ [scope]: true, maxAge: def.cache.maxAge }).toString(),
        );
      }

      if (def.headers) {
        for (const [key, value] of Object.entries(def.headers)) {
          c.header(key, value);
        }
      }

      try {
        return await def.view(c);
      } catch (err) {
        if (def.onError) return def.onError(err as Error, c);
        throw err;
      }
    },
  };
}
