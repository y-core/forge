/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Switch as CoreSwitch } from "../core/switch";
import { createBoundControl } from "./create-bound-control";

/** Pre-bound `Switch` that stamps `data-field`. @public */
export const Switch = createBoundControl(CoreSwitch);
