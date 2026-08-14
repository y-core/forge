import type { Middleware } from "@remix-run/fetch-router";
import { type RequestMethod, Route, type RouteMap } from "@remix-run/fetch-router/routes";

/** Attribute filter for {@link routePaths}. @public */
export interface RouteFilter {
  /** Restrict to routes serving this HTTP method; omit to match all. */
  method?: RequestMethod | "ANY";
}

/** Recursively collects the path string of every {@link Route} in a route map that matches the filter. @internal */
function collectPaths(routeMap: RouteMap, filter: RouteFilter): string[] {
  const paths: string[] = [];
  for (const value of Object.values(routeMap)) {
    if (value instanceof Route) {
      if (filter.method === undefined || value.method === filter.method || value.method === "ANY") {
        paths.push(value.pattern.source);
      }
    } else {
      paths.push(...collectPaths(value, filter));
    }
  }
  return paths;
}

/** Collects the path strings of every {@link Route} in a route map, optionally filtered by attribute. @public */
export function routePaths(routeMap: RouteMap, filter: RouteFilter = {}): string[] {
  const paths = collectPaths(routeMap, filter);
  if (paths.length > 0 || filter.method === undefined) return paths;
  if (collectPaths(routeMap, {}).length === 0) return paths;
  throw new Error(`routePaths: no route serves method "${filter.method}" — the filtered path list would be empty.`);
}

/** Wraps `middleware` so it runs only for the given request method(s), and is skipped otherwise. @public */
export function forMethod(method: RequestMethod | RequestMethod[], middleware: Middleware): Middleware {
  const allowed = new Set((Array.isArray(method) ? method : [method]).map((m) => m.toUpperCase()));
  return (context, next) => (allowed.has(context.method.toUpperCase()) ? middleware(context, next) : next());
}
