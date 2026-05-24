import type { Env, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { RouteConfig, RouteConfigEntry, RouteModule } from "./types";

function applyMiddleware<E extends Env = Env>(app: Hono<E>, path: string, mw: MiddlewareHandler<E>[]): void {
  if (mw.length === 0) return;
  const [first, ...rest] = mw;
  app.use(path, first, ...rest);
}

function registerModule<E extends Env = Env>(app: Hono<E>, path: string, module: RouteModule<E>): void {
  const { action, loader, middleware, view } = module;

  if (middleware) {
    applyMiddleware(app, path, toArray(middleware));
  }

  if (loader || view) {
    app.get(path, async (c) => {
      let data: unknown;

      if (loader) {
        const result = await loader(c);
        if (result instanceof Response) {
          return result;
        }
        data = result;
      }

      if (!view) {
        throw new Error(`GET route "${path}" is missing a view`);
      }

      return view(c, { actionData: undefined, data, method: "GET" });
    });
  }

  if (action) {
    app.post(path, async (c) => {
      const result = await action(c);
      if (result instanceof Response || !view) {
        if (result instanceof Response) {
          return result;
        }
        throw new Error(`POST route "${path}" returned data without a view`);
      }

      return view(c, { actionData: result, data: undefined, method: "POST" });
    });
  }
}

function applyEntry<E extends Env = Env>(app: Hono<E>, entry: RouteConfigEntry<E>, prefix = ""): void {
  if (entry.index) {
    registerModule(app, prefix || "/", entry.module);
    return;
  }

  if (entry.path === undefined) {
    // Layout: scope middleware to a sub-app and mount it
    if (entry.module.middleware) {
      const group = new Hono<E>();
      const [first, ...rest] = toArray(entry.module.middleware);
      group.use("*", first, ...rest);
      for (const child of entry.children ?? []) {
        applyEntry(group, child, "");
      }
      app.route(prefix || "/", group);
    } else {
      for (const child of entry.children ?? []) {
        applyEntry(app, child, prefix);
      }
    }
    return;
  }

  const fullPath = prefix + entry.path;
  registerModule(app, fullPath, entry.module);
  for (const child of entry.children ?? []) {
    applyEntry(app, child, fullPath);
  }
}

/** @internal Wraps a single value or array into a guaranteed array. */
export function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/** Registers a declarative route config tree onto a Hono app. */
export function applyRoutes<E extends Env = Env>(app: Hono<E>, routes: RouteConfig<E>): void {
  for (const entry of routes) {
    applyEntry(app, entry);
  }
}
