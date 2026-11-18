import type { Route } from "@remix-run/fetch-router/routes";
import type { RequestMethod } from "@remix-run/fetch-router/routes";
import type { MatchParams } from "@remix-run/route-pattern/match";

/** Attribute filter for {@link routePaths}. @public */
export interface RouteFilter {
  /** Restrict to routes serving this HTTP method; omit to match all. */
  method?: RequestMethod | "ANY";
}

/** The params a request matched against `R` carries, read off the route's pattern. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- any method and any pattern are both route shapes this reads
export type RouteParams<R extends Route<any, any>> = R extends Route<any, infer P extends string> ? MatchParams<P> : never;
