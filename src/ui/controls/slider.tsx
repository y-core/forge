/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { Slider as CoreSlider } from "../core/slider";
import { fieldAttr } from "../server/field-attr";
import { scopeAttrs } from "../server/scope-attrs";

type BoundSliderProps = Parameters<typeof CoreSlider>[0] & { bind: string; action?: string };

/**
 * Pre-bound `Slider` that stamps `data-on-input` + `data-field` for the resumable-scope
 * `bindField` action. The `bind` prop names the `SignalRecord` field; `action` overrides
 * the default action name `"bindField"`. @public
 */
export const Slider: FC<BoundSliderProps> = ({ bind, action = "bindField", ...props }) => (
  <CoreSlider {...props} {...scopeAttrs({ onInput: action })} {...fieldAttr(bind)} />
);
