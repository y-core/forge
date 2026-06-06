import type { Middleware, RequestHandler } from "@remix-run/fetch-router";
import { createController } from "@remix-run/fetch-router";
import type { RequestMethod } from "@remix-run/fetch-router/routes";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";
import type { Forge } from "./forge-app";

/** A route action for the test helper: a bare handler or a `{ middleware, handler }` object. */
export type TestAction = RequestHandler | { middleware: readonly Middleware[]; handler: RequestHandler };

/**
 * Test-only single-route registrar mirroring the declarative `app.map(routes, controller)`
 * surface. Replaces the removed imperative `app.get/post/all` in the test suite; excluded from
 * the published package (see `package.json` `files`). Routes are built from a `Route` instance
 * (not an object literal) because the latter rejects `"ANY"` at the type level. @internal
 */
export function mapHandler<Bindings extends object, M extends RequestMethod | "ANY", P extends string>(
  app: Forge<Bindings>,
  method: M,
  pattern: P,
  action: TestAction,
): void {
  const routes = createRoutes({ r: new Route(method, pattern) });
  app.map(routes, createController(routes, { actions: { r: action } }));
}
