import type { v } from "../validation/validation";
import { defineAction } from "./action";
import { definePage } from "./page";
import type { ActionDefinition, PageDefinition } from "./types";

/** Pre-bound `definePage`/`defineAction` pair returned by `createHandlerFactory`. @public */
export interface HandlerFactory<Bindings = Record<string, unknown>, ConfigData = unknown> {
  definePage: <LoaderData = unknown, ActionData = unknown, S extends v.GenericSchema = v.GenericSchema>(
    def: PageDefinition<Bindings, ConfigData, LoaderData, ActionData, S>,
  ) => ReturnType<typeof definePage>;
  defineAction: <S extends v.GenericSchema>(def: ActionDefinition<S, Bindings, ConfigData>) => ReturnType<typeof defineAction>;
}

/** Returns `definePage`/`defineAction` with `Bindings` and `ConfigData` pre-bound. @public */
export function createHandlerFactory<Bindings = Record<string, unknown>, ConfigData = unknown>(): HandlerFactory<Bindings, ConfigData> {
  return { definePage: (def) => definePage(def), defineAction: (def) => defineAction(def) };
}
