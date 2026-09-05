/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { NumberField as CoreNumberField } from "../core/number-field";
import { createBoundCompound, createBoundControl } from "./create-bound-control";

// Only `.Input` is bound: the steppers drive the input, and the input is what `bindControls` reads.
const BoundInput = createBoundControl(CoreNumberField.Input);

/** Pre-bound `NumberField` whose `.Input` stamps `data-field`. @public */
export const NumberField = createBoundCompound(CoreNumberField, { Input: BoundInput });
