/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Input as CoreInput } from "../core/input";
import { createBoundControl } from "./create-bound-control";

/** Pre-bound `Input` that stamps `data-field`. @public */
export const Input = createBoundControl(CoreInput);
