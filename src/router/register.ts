import type { Env, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { RouteConfig, RouteConfigEntry, RouteModule } from "./types";

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function applyMiddleware(app: Hono<Env>, path: string, mw: MiddlewareHandler[]): void {
  if (mw.length === 0) return;
  // Use spread as a non-empty tuple so TypeScript is satisfied
  const [first, ...rest] = mw;
  app.use(path, first, ...rest);
}

function registerModule(app: Hono<Env>, path: string, module: RouteModule): void {
  const { loader, action, view, middleware } = module;

  if (middleware) {
    applyMiddleware(app, path, toArray(middleware));
  }

  const getHandler = view ?? loader;
  if (getHandler) app.get(path, getHandler);
  if (action) app.post(path, action);
}

function applyEntry(app: Hono<Env>, entry: RouteConfigEntry, prefix = ""): void {
  if (entry.index) {
    registerModule(app, prefix || "/", entry.module);
    return;
  }

  if (entry.path === undefined) {
    // Layout: scope middleware to a sub-app and mount it
    if (entry.module.middleware) {
      const group = new Hono<Env>();
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

export function applyRoutes<E extends Env = Env>(app: Hono<E>, routes: RouteConfig<E>): void {
  for (const entry of routes) {
    applyEntry(app as unknown as Hono<Env>, entry as unknown as RouteConfigEntry);
  }
}
