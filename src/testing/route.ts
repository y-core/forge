import type { Middleware, RequestHandler } from "@remix-run/fetch-router";
import type { RequestMethod } from "@remix-run/fetch-router/routes";
import { Route } from "@remix-run/fetch-router/routes";

import type { Forge } from "../app/forge-app";
import type { TestAction } from "./types";

/** Registers a single route on a `Forge` app for tests, mirroring `app.map(route, action)`. @public */
export function mapHandler<Bindings extends object, M extends RequestMethod | "ANY", P extends string>(
  app: Forge<Bindings>,
  method: M,
  pattern: P,
  action: TestAction<P>,
): void {
  const paramless = action as RequestHandler | { middleware: readonly Middleware[]; handler: RequestHandler };
  app.map(new Route(method, pattern), paramless);
}
