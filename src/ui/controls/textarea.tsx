/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Textarea as CoreTextarea } from "../core/textarea";
import { createBoundControl } from "./create-bound-control";

/**
 * Pre-bound `Textarea` that stamps `data-on-input` + `data-field` for the resumable-scope
 * `bindField` action. The `bind` prop names the `SignalRecord` field; `action` overrides
 * the default action name `"bindField"`. @public
 */
export const Textarea = createBoundControl(CoreTextarea, { event: "onInput", defaultAction: "bindField" });
