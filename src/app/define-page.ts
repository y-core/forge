import { CacheControl } from "@remix-run/headers";
import type { Env } from "hono";
import type { RouteModule } from "../router/types";
import type { PageDefinition } from "./types";

export function definePage<E extends Env = Env>(def: PageDefinition<E>): RouteModule<E> {
  const middleware = def.middleware ? Array.isArray(def.middleware) ? def.middleware : [def.middleware] : [];

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

      return def.view(c);
    },
  };
}
