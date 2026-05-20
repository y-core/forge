import type { Env } from "hono";
import type { RouteConfigEntry, RouteModule } from "./types";

export function route<E extends Env = Env>(
  path: string,
  module: RouteModule<E>,
  children?: RouteConfigEntry<E>[],
): RouteConfigEntry<E> {
  return { path, module, ...(children ? { children } : {}) };
}

export function index<E extends Env = Env>(module: RouteModule<E>): RouteConfigEntry<E> {
  return { index: true, module };
}

export function layout<E extends Env = Env>(
  module: RouteModule<E>,
  children: RouteConfigEntry<E>[],
): RouteConfigEntry<E> {
  return { module, children };
}

export function prefix<E extends Env = Env>(
  path: string,
  routes: RouteConfigEntry<E>[],
): RouteConfigEntry<E>[] {
  return routes.map((entry) => ({
    ...entry,
    path: entry.path !== undefined ? path + entry.path : entry.path,
  }));
}
