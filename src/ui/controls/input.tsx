/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Input as CoreInput } from "../core/input";
import { createBoundControl } from "./create-bound-control";

/**
 * Pre-bound `Input` that stamps `data-on-input` + `data-field` for the resumable-scope
 * `bindField` action. The `bind` prop names the `SignalRecord` field; `action` overrides
 * the default action name `"bindField"`. @public
 */
export const Input = createBoundControl(CoreInput, { event: "onInput", defaultAction: "bindField" });
