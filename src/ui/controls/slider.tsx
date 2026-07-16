/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Slider as CoreSlider } from "../core/slider";
import { createBoundControl } from "./create-bound-control";

/**
 * Pre-bound `Slider` that stamps `data-on-input` + `data-field` for the resumable-scope
 * `bindField` action. The `bind` prop names the `SignalRecord` field; `action` overrides
 * the default action name `"bindField"`. @public
 */
export const Slider = createBoundControl(CoreSlider, { event: "onInput", defaultAction: "bindField" });
