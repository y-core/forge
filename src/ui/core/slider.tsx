/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { scopeAttrs } from "../contracts/scope-attrs";
import { SLIDER_SCOPE } from "../contracts/slider-contract";
import type { SliderAction } from "../contracts/types";
import type { Size } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { fieldControlProps, fieldStateProps } from "./field";
import type { FieldDescriptor } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { FIELD_SIZE } from "./utils/recipes";

type SliderProps = Omit<JSX.IntrinsicElements["input"], "children" | "size" | "type"> & {
  field?: FieldDescriptor | undefined;
  output?: boolean | undefined;
  orientation?: "horizontal" | "vertical" | undefined;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
};

/** HTML's "valid floating-point number": no leading `+`, no surrounding whitespace, no bare
 *  trailing `.` — but a leading `.` is fine. */
const VALID_FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function toNumber(raw: string | number | readonly string[] | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const s = String(raw);
  if (!VALID_FLOAT.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Scrubs binary-float noise: `17 * 0.3` is `5.1000000000000005`, but the browser shows `5.1`. */
function scrub(n: number): number {
  return Number(n.toPrecision(15));
}

/** Applies the HTML value-sanitization algorithm for `input[type=range]`, returning the value the browser will itself settle on. @internal */
export function sanitizeRangeValue(attrs: Pick<JSX.IntrinsicElements["input"], "min" | "max" | "step" | "value">): string {
  const min = toNumber(attrs.min) ?? 0;
  const maxRaw = toNumber(attrs.max) ?? 100;
  const max = maxRaw < min ? min : maxRaw;

  const stepAny = attrs.step !== undefined && String(attrs.step).toLowerCase() === "any";
  const stepNum = toNumber(attrs.step);
  const step = stepAny ? undefined : stepNum !== undefined && stepNum > 0 ? stepNum : 1;

  const value = toNumber(attrs.value) ?? min + (max - min) / 2;
  // The `value` term is load-bearing: with no `min`, HTML aligns a value to itself and never snaps
  // it away.
  const base = toNumber(attrs.min) ?? toNumber(attrs.value) ?? 0;

  const clamped = Math.min(Math.max(value, min), max);
  if (step === undefined) return String(scrub(clamped));

  // The quotient is scrubbed before rounding as well as after: `0.35 / 0.1` is 3.4999999999999996,
  // which rounds down where the browser rounds a tie up.
  let snapped = scrub(base + Math.round(scrub((clamped - base) / step)) * step);
  if (snapped > max) snapped = scrub(base + Math.floor(scrub((max - base) / step)) * step);
  if (snapped < min) snapped = scrub(base + Math.ceil(scrub((min - base) / step)) * step);
  return String(snapped);
}

// The input's box is the hit target, not the track: the track and thumb are painted by the
// `::-webkit-slider-runnable-track` / `::-moz-range-track` rules in `forge-ui.css`.
// `cursor-pointer` travels in its own `cn` argument, never beside `state-busy`: the recipe paints
// `cursor: progress` conditionally, and one literal holding both is a conflict the sorter resolves.
const SLIDER_BASE = "state-disabled state-busy state-invalid w-full appearance-none rounded-full bg-transparent focus-ring";
const SLIDER_VERTICAL = "[writing-mode:vertical-lr] [direction:rtl] h-22 w-8";

/** A range `<input>`, optionally paired with an `<output>` readout of its value. @public */
export const Slider: FC<SliderProps> = ({
  class: cls,
  field,
  output,
  orientation = "horizontal",
  size = "md",
  invalid = false,
  busy = false,
  "data-slot": inherited,
  ...props
}) => {
  const resolved = field ? fieldControlProps(props, field) : props;
  const isVertical = orientation === "vertical";
  const sliderCls = cn(SLIDER_BASE, "cursor-pointer", FIELD_SIZE[size], isVertical && SLIDER_VERTICAL, cls);
  const state = fieldStateProps(invalid, busy);
  if (!output) {
    return (
      <input data-slot={slotToken("slider", inherited)} type='range' {...presentationAttrs({ size })} class={sliderCls} {...resolved} {...state} />
    );
  }

  const control = (
    <input
      data-slot={slotToken("slider", inherited)}
      type='range'
      {...presentationAttrs({ size })}
      class={sliderCls}
      {...scopeAttrs<SliderAction>({ onInput: "sync" })}
      {...resolved}
      {...state}
    />
  );
  const readout = sanitizeRangeValue(resolved);
  return (
    <div data-slot='slider-wrapper' data-scope={SLIDER_SCOPE} class={cn("flex gap-2", isVertical ? "flex-col items-center" : "items-center")}>
      {control}
      <output data-slot='slider-output' class='text-sm text-muted-foreground tabular-nums'>
        {readout}
      </output>
    </div>
  );
};
