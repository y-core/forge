/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { NumberField as CoreNumberField } from "../core/number-field";
import { createBoundControl } from "./create-bound-control";

type NumberFieldRootProps = Parameters<typeof CoreNumberField>[0];

// Only `.Input` is bound: the steppers drive the input, and the input is what `bindControls` reads.
const BoundInput = createBoundControl(CoreNumberField.Input);

const NumberFieldRoot: FC<NumberFieldRootProps> = (props) => <CoreNumberField {...props} />;

/** Pre-bound `NumberField` whose `.Input` stamps `data-field`. @public */
export const NumberField = Object.assign(NumberFieldRoot, {
  Input: BoundInput,
  Decrement: CoreNumberField.Decrement,
  Increment: CoreNumberField.Increment,
});
