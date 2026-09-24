/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Select as CoreSelect } from "../core/select";
import { createBoundControl } from "./create-bound-control";

/** Pre-bound `Select` that stamps `data-field`. @public */
export const Select = createBoundControl(CoreSelect);
