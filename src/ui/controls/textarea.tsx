/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Textarea as CoreTextarea } from "../core/textarea";
import { createBoundControl } from "./create-bound-control";

/** Pre-bound `Textarea` that stamps `data-field`. @public */
export const Textarea = createBoundControl(CoreTextarea);
