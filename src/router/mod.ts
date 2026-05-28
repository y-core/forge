export type { Context, MiddlewareHandler, Next } from "hono";
export { Hono as App } from "hono";
export { index, layout, prefix, route } from "./config";
export { applyRoutes } from "./register";
export type {
  InferConfig,
  RouteAction,
  RouteConfig,
  RouteConfigEntry,
  RouteLoader,
  RouteModule,
  RouteRenderState,
  RouteView,
} from "./types";
