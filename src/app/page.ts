import { CacheControl } from "@remix-run/headers";
import type { Env } from "hono";
import type { InferConfig } from "../config/config";
import { toError } from "../result/result";
import type { RouteModule } from "../router/types";
import type { PageDefinition } from "./types";

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/** Wraps a view function with optional caching, custom headers, middleware, and error recovery. @public */
export function definePage<
  E extends Env = Env,
  LoaderData = unknown,
  ActionData = unknown,
>(def: PageDefinition<E, LoaderData, ActionData>): RouteModule<E, LoaderData, ActionData> {
  const middleware = def.middleware ? toArray(def.middleware) : [];
  const loader = def.loader;
  const action = def.action;

  function applyHeaders(c: Parameters<typeof def.view>[0]): void {
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
  }

  return {
    middleware: middleware.length > 0 ? middleware : undefined,
    ...(loader
      ? {
          loader: async (c, config: InferConfig<E>) => {
            applyHeaders(c);
            try {
              return await loader(c, config);
            } catch (err) {
              if (def.onError) return def.onError(toError(err), c);
              throw err;
            }
          },
        }
      : {}),
    ...(action
      ? {
          action: async (c, config: InferConfig<E>) => {
            applyHeaders(c);
            try {
              return await action(c, config);
            } catch (err) {
              if (def.onError) return def.onError(toError(err), c);
              throw err;
            }
          },
        }
      : {}),
    view: async (c, config: InferConfig<E>, state) => {
      applyHeaders(c);

      try {
        return await def.view(c, config, state);
      } catch (err) {
        if (def.onError) return def.onError(toError(err), c);
        throw err;
      }
    },
  };
}
