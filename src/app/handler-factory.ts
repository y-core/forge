import { defineAction } from "./action";
import { definePage } from "./page";
import type { HandlerFactory } from "./types";

/** Returns `definePage`/`defineAction` with `Bindings` and `ConfigData` pre-bound. @public */
export function createHandlerFactory<Bindings = Record<string, unknown>, ConfigData = unknown>(): HandlerFactory<Bindings, ConfigData> {
  return { definePage: (route, def) => definePage(route, def), defineAction: (route, def) => defineAction(route, def) };
}
