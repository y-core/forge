/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { ToggleGroup as CoreToggleGroup } from "../core/toggle-group";
import { createBoundCompound, createBoundItem } from "./create-bound-control";

/** Pre-bound `ToggleGroup` whose `.Item` stamps `data-field` + `data-value`. @public */
export const ToggleGroup = createBoundCompound(CoreToggleGroup, { Item: createBoundItem(CoreToggleGroup.Item) });
