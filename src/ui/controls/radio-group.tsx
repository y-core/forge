/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { RadioGroup as CoreRadioGroup } from "../core/radio-group";
import { createBoundCompound, createBoundItem } from "./create-bound-control";

/** Pre-bound `RadioGroup` whose `.Item` stamps `data-field` + `data-value`. @public */
export const RadioGroup = createBoundCompound(CoreRadioGroup, { Item: createBoundItem(CoreRadioGroup.Item) });
