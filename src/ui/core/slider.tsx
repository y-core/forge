/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import { asClass, cn } from "./utils/cn";

type SliderProps = Omit<JSX.IntrinsicElements["input"], "type" | "children"> & { field?: FieldDescriptor; output?: boolean };

const SLIDER_BASE = "h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50";

export const Slider: FC<SliderProps> = ({ class: cls, field, output, ...props }) => {
  const resolved = field ? fieldControlProps(props, field) : props;
  const control = <input data-slot='slider' type='range' class={cn(SLIDER_BASE, asClass(cls))} {...resolved} />;

  if (!output) {
    return control;
  }

  // `value` may be `readonly string[]` (multi-select shape); coerce to a scalar JSXNode for the readout.
  const readout = typeof props.value === "object" ? props.value.join(", ") : props.value;
  return (
    <div data-slot='slider-wrapper' class='flex items-center gap-2'>
      {control}
      <output data-slot='slider-output' class='text-sm tabular-nums text-muted-foreground'>
        {readout}
      </output>
    </div>
  );
};
