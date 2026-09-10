import type { RequestMethod } from "@remix-run/fetch-router/routes";

/** Attribute filter for {@link routePaths}. @public */
export interface RouteFilter {
  /** Restrict to routes serving this HTTP method; omit to match all. */
  method?: RequestMethod | "ANY";
}
