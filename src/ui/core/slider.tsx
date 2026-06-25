/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import { asClass, cn } from "./utils/cn";

type SliderProps = Omit<JSX.IntrinsicElements["input"], "type" | "children"> & {
  field?: FieldDescriptor;
  output?: boolean;
  orientation?: "horizontal" | "vertical";
};

const SLIDER_BASE = "h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50";
const SLIDER_VERTICAL = "[writing-mode:vertical-lr] [direction:rtl] h-22 w-5";

export const Slider: FC<SliderProps> = ({ class: cls, field, output, orientation = "horizontal", ...props }) => {
  const resolved = field ? fieldControlProps(props, field) : props;
  const isVertical = orientation === "vertical";
  const sliderCls = cn(SLIDER_BASE, isVertical && SLIDER_VERTICAL, asClass(cls));
  const control = <input data-slot='slider' type='range' class={sliderCls} {...resolved} />;

  if (!output) {
    return control;
  }

  // `value` may be `readonly string[]` (multi-select shape); coerce to a scalar JSXNode for the readout.
  const readout = typeof props.value === "object" ? props.value.join(", ") : props.value;
  return (
    <div data-slot='slider-wrapper' class={cn("flex gap-2", isVertical ? "flex-col items-center" : "items-center")}>
      {control}
      <output data-slot='slider-output' class='text-sm tabular-nums text-muted-foreground'>
        {readout}
      </output>
    </div>
  );
};
