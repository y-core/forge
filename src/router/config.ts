import type { Env } from "hono";
import type { RouteConfigEntry, RouteModule } from "./types";

/** Declares a path-matched route with an optional children array. @public */
export function route<E extends Env = Env>(
  path: string,
  module: RouteModule<E>,
  children?: RouteConfigEntry<E>[],
): RouteConfigEntry<E> {
  return { path, module, ...(children ? { children } : {}) };
}

/** Declares an index route that matches the parent segment's exact path. @public */
export function index<E extends Env = Env>(module: RouteModule<E>): RouteConfigEntry<E> {
  return { index: true, module };
}

/** Groups child routes under shared middleware without adding a URL segment. @public */
export function layout<E extends Env = Env>(
  module: RouteModule<E>,
  children: RouteConfigEntry<E>[],
): RouteConfigEntry<E> {
  return { module, children };
}

/**
 * Prepends a path segment to every entry in the given array. @public
 *
 * Only the top-level entries are prefixed — children are intentionally left
 * unprefixed because `applyRoutes` accumulates prefixes recursively during
 * registration. Prefixing children here would double-prefix their paths
 * (e.g. `/api/users` → `/api/users/api/profile`).
 */
export function prefix<E extends Env = Env>(
  path: string,
  routes: RouteConfigEntry<E>[],
): RouteConfigEntry<E>[] {
  return routes.map((entry) => ({
    ...entry,
    path: entry.path !== undefined ? path + entry.path : entry.path,
  }));
}
