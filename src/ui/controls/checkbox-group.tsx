/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { CheckboxGroup as CoreCheckboxGroup } from "../core/checkbox-group";
import { createBoundCompound, createBoundItem } from "./create-bound-control";

/** Pre-bound `CheckboxGroup` whose `.Item` stamps `data-field` + `data-value`. @public */
export const CheckboxGroup = createBoundCompound(CoreCheckboxGroup, { Item: createBoundItem(CoreCheckboxGroup.Item) });
