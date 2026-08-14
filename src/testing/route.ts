import type { Middleware, RequestHandler } from "@remix-run/fetch-router";
import { createController } from "@remix-run/fetch-router";
import type { RequestMethod } from "@remix-run/fetch-router/routes";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";
import type { Forge } from "../app/forge-app";

/** A route action for the test helper: a bare handler or a `{ middleware, handler }` object. @public */
export type TestAction = RequestHandler | { middleware: readonly Middleware[]; handler: RequestHandler };

/** Registers a single route on a `Forge` app for tests, mirroring `app.map(routes, controller)`. @public */
export function mapHandler<Bindings extends object, M extends RequestMethod | "ANY", P extends string>(
  app: Forge<Bindings>,
  method: M,
  pattern: P,
  action: TestAction,
): void {
  const routes = createRoutes({ r: new Route(method, pattern) });
  app.map(routes, createController(routes, { actions: { r: action } }));
}
