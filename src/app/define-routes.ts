import type { Env } from "hono";
import type { RouteConfig } from "../router/types";

export function defineRoutes<E extends Env = Env>(routes: RouteConfig<E>): RouteConfig<E> {
  return routes;
}
