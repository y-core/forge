/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Toggle as CoreToggle } from "../core/toggle";
import { createBoundControl } from "./create-bound-control";

/** Pre-bound `Toggle` that stamps `data-field` on its checkbox. @public */
export const Toggle = createBoundControl(CoreToggle);
