// Core router engine

export type {
  Action,
  Controller,
  MatchData,
  Middleware,
  MiddlewareContext,
  RequestHandler,
  RouteEntry,
  RouterOptions,
  RouterTypes,
} from "@remix-run/fetch-router";
export { createAction, createContextKey, createController, createMiddleware, createRouter, RequestContext } from "@remix-run/fetch-router";
export type {
  BuildRoute,
  FormOptions,
  ResourceMethod,
  ResourceOptions,
  ResourcesMethod,
  ResourcesOptions,
  RouteDef,
  RouteDefs,
  RouteMap,
} from "@remix-run/fetch-router/routes";
// Route authoring helpers
export { del, form, get, head, options, patch, post, put, Route, resource, resources, route } from "@remix-run/fetch-router/routes";
// Type-safe URL generation from route patterns
export type { CreateHrefArgs } from "@remix-run/route-pattern/href";
export { CreateHrefError, createHref } from "@remix-run/route-pattern/href";
export type { JoinPatterns } from "@remix-run/route-pattern/join";
export { joinPatterns } from "@remix-run/route-pattern/join";
