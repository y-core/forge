import type { Context, Env, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { Config, ConfigVariables, InferConfig } from "../config/config";
import { resolveConfig } from "../config/config";
import { retrieveConfig } from "../config/registry";
import type { RouteConfig, RouteConfigEntry, RouteModule } from "./types";

function applyMiddleware<E extends Env>(
  app: Hono<E>,
  path: string,
  mw: MiddlewareHandler<E>[],
): void {
  if (mw.length === 0) return;
  const [first, ...rest] = mw;
  app.use(path, first, ...rest);
}

function registerModule<E extends Env>(
  app: Hono<E>,
  path: string,
  module: RouteModule<E>,
  configStore: Config<InferConfig<E>> | undefined,
): void {
  const { action, loader, middleware, view } = module;

  if (middleware) {
    applyMiddleware(app, path, toArray(middleware));
  }

  if (loader || view) {
    app.get(path, async (c) => {
      const config = resolveConfig(configStore, c.env ?? {});
      (c as unknown as Context<ConfigVariables<InferConfig<E>>>).set("config", config);
      let data: unknown;

      if (loader) {
        const result = await loader(c, config);
        if (result instanceof Response) {
          return result;
        }
        data = result;
      }

      if (!view) {
        throw new Error(`GET route "${path}" is missing a view`);
      }

      return view(c, config, { actionData: undefined, data, method: "GET" });
    });
  }

  if (action) {
    app.post(path, async (c) => {
      const config = resolveConfig(configStore, c.env ?? {});
      (c as unknown as Context<ConfigVariables<InferConfig<E>>>).set("config", config);
      const result = await action(c, config);
      if (result instanceof Response || !view) {
        if (result instanceof Response) {
          return result;
        }
        throw new Error(`POST route "${path}" returned data without a view`);
      }

      return view(c, config, { actionData: result, data: undefined, method: "POST" });
    });
  }
}

function applyEntry<E extends Env>(
  app: Hono<E>,
  entry: RouteConfigEntry<E>,
  prefix: string,
  configStore: Config<InferConfig<E>> | undefined,
): void {
  if (entry.index) {
    registerModule(app, prefix || "/", entry.module, configStore);
    return;
  }

  if (entry.path === undefined) {
    if (entry.module.middleware) {
      const group = new Hono<E>();
      const [first, ...rest] = toArray(entry.module.middleware);
      group.use("*", first, ...rest);
      for (const child of entry.children ?? []) {
        applyEntry(group, child, "", configStore);
      }
      app.route(prefix || "/", group);
    } else {
      for (const child of entry.children ?? []) {
        applyEntry(app, child, prefix, configStore);
      }
    }
    return;
  }

  const fullPath = prefix + entry.path;
  registerModule(app, fullPath, entry.module, configStore);
  for (const child of entry.children ?? []) {
    applyEntry(app, child, fullPath, configStore);
  }
}

/** @internal Wraps a single value or array into a guaranteed array. */
export function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/** Registers a declarative route config tree onto a Hono app. */
export function applyRoutes<E extends Env = Env>(app: Hono<E>, routes: RouteConfig<E>): void {
  const configStore = retrieveConfig<InferConfig<E>>(app);
  for (const entry of routes) {
    applyEntry(app, entry, "", configStore);
  }
}
