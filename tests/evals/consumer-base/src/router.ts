import type { Forge } from "@y-core/forge/app";
import { createController } from "@y-core/forge/router";

import type { Bindings } from "./app/types";
import { homePage } from "./controllers/home";
import { routes } from "./routes";

export function registerRoutes(app: Forge<Bindings>): void {
  app.map(routes, createController(routes, { actions: { home: homePage } }));
}
