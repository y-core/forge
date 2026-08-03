import type { Middleware } from "@remix-run/fetch-router";
import { type RequestMethod, Route, type RouteMap } from "@remix-run/fetch-router/routes";

/** Attribute filter for {@link routePaths}. @public */
export interface RouteFilter {
  /** Restrict to routes that serve this HTTP method (e.g. "POST"). A route declared `ANY` serves
   *  every method, so it matches any concrete method here. `"ANY"` is not a wildcard — it selects
   *  only routes declared `ANY`. Omit to match all. */
  method?: RequestMethod | "ANY";
}

/** Walk a route map, collecting the path string of every {@link Route} that matches the filter.
 *  Recurses into nested maps; a branch that contributes nothing is normal. @internal */
function collectPaths(routeMap: RouteMap, filter: RouteFilter): string[] {
  const paths: string[] = [];
  for (const value of Object.values(routeMap)) {
    if (value instanceof Route) {
      // An `ANY` route is dispatched for every method, so it serves any concrete method filter.
      // The `ANY` filter itself is still exact — it is caught by the equality check.
      if (filter.method === undefined || value.method === filter.method || value.method === "ANY") {
        paths.push(value.pattern.source);
      }
    } else {
      paths.push(...collectPaths(value, filter));
    }
  }
  return paths;
}

/** Collect the path strings of every {@link Route} in a route map, optionally filtered by
 *  attribute (e.g. method). Recurses nested route maps. Reverses a `route()` declaration into a
 *  flat path list — useful for wiring per-path middleware.
 *
 *  A route declared `ANY` is dispatched for every method, so it is included under any concrete
 *  method filter. `{ method: "ANY" }` is not a wildcard: it selects only routes declared `ANY`.
 *
 *  Throws when a method filter matches nothing in a route map that does contain routes — the
 *  caller is almost always about to attach middleware, and an empty path list would silently
 *  attach it to nothing. An unfiltered call, and a route map with no routes at all, never throw.
 *  @public */
export function routePaths(routeMap: RouteMap, filter: RouteFilter = {}): string[] {
  const paths = collectPaths(routeMap, filter);
  if (paths.length > 0 || filter.method === undefined) return paths;
  if (collectPaths(routeMap, {}).length === 0) return paths;
  throw new Error(`routePaths: no route serves method "${filter.method}" — the filtered path list would be empty.`);
}

/** Wrap `middleware` so it runs only for the given request method(s), and is skipped otherwise.
 *  The other half of the {@link routePaths} pattern.
 *
 *  **`app.use` is path-scoped only** — dispatch never consults the method — so feeding a
 *  `routePaths(routes, { method: "POST" })` list into it attaches the middleware to those *paths*
 *  for every method they serve. That is not merely theoretical: a route declared `ANY` is included
 *  under any concrete method filter, and a path declared both `get("/x")` and `post("/x")` always
 *  had the same overlap. Wrapping closes it:
 *
 *  ```ts
 *  for (const path of routePaths(routes, { method: "POST" })) {
 *    app.use(path, forMethod("POST", csrfGuard));
 *  }
 *  ```
 *
 *  Reads `context.method` rather than `context.request.method`, so an override applied by
 *  `methodOverride` is honoured — the same value dispatch itself matches on. Note that forge
 *  rewrites `HEAD` to `GET` before routing, so `forMethod("GET", …)` also covers `HEAD`. @public */
export function forMethod(method: RequestMethod | RequestMethod[], middleware: Middleware): Middleware {
  const allowed = new Set((Array.isArray(method) ? method : [method]).map((m) => m.toUpperCase()));
  return (context, next) => (allowed.has(context.method.toUpperCase()) ? middleware(context, next) : next());
}
