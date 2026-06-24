import { type RequestMethod, Route, type RouteMap } from "@remix-run/fetch-router/routes";

/** Attribute filter for {@link routePaths}. @public */
export interface RouteFilter {
  /** Restrict to routes whose HTTP method matches exactly (e.g. "POST"). Omit to match all. */
  method?: RequestMethod | "ANY";
}

/** Collect the path strings of every {@link Route} in a route map, optionally filtered by
 *  attribute (e.g. method). Recurses nested route maps. Reverses a `route()` declaration into a
 *  flat path list — useful for wiring per-path middleware. @public */
export function routePaths(routeMap: RouteMap, filter: RouteFilter = {}): string[] {
  const paths: string[] = [];
  for (const value of Object.values(routeMap)) {
    if (value instanceof Route) {
      if (filter.method === undefined || value.method === filter.method) paths.push(value.pattern.source);
    } else {
      paths.push(...routePaths(value, filter));
    }
  }
  return paths;
}
