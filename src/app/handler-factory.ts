import { defineAction } from "./action";
import { definePage } from "./page";
import type { ActionDefinition, PageDefinition } from "./types";

/** Pre-bound `definePage`/`defineAction` pair returned by `createHandlerFactory`. @public */
export interface HandlerFactory<Bindings = Record<string, unknown>, ConfigData = unknown> {
  definePage: <LoaderData = unknown, ActionData = unknown>(
    def: PageDefinition<Bindings, ConfigData, LoaderData, ActionData>,
  ) => ReturnType<typeof definePage>;
  defineAction: <Input>(def: ActionDefinition<Input, Bindings, ConfigData>) => ReturnType<typeof defineAction>;
}

/**
 * Returns `definePage`/`defineAction` with `Bindings` and `ConfigData` pre-bound, so route
 * handlers stop repeating the same two generic arguments on every call. Call it once per app
 * and import the bound pair everywhere. The per-call generics (`LoaderData`, `ActionData`,
 * `Input`) remain inferable or explicitly specifiable as before.
 *
 * @example
 * ```typescript
 * // app/handlers.ts — bind once:
 * export const { definePage, defineAction } = createHandlerFactory<AppEnv, AppConfig>();
 *
 * // controllers/home.tsx — no generics needed:
 * export const homePage = definePage({
 *   loader: async (c, config) => ({ greeting: config.site.name }),
 *   view: (_c, _cfg, state) => renderPage(<Home greeting={state.data.greeting} />),
 * });
 * ```
 * @public
 */
export function createHandlerFactory<Bindings = Record<string, unknown>, ConfigData = unknown>(): HandlerFactory<Bindings, ConfigData> {
  return { definePage: (def) => definePage(def), defineAction: (def) => defineAction(def) };
}
