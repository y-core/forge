/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Slider as CoreSlider } from "../core/slider";
import { createBoundControl } from "./create-bound-control";

/** Pre-bound `Slider` that stamps `data-field`. @public */
export const Slider = createBoundControl(CoreSlider);
