/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type SliderProps = Omit<JSX.IntrinsicElements["input"], "type" | "children"> & {
  field?: FieldDescriptor;
  output?: boolean;
  orientation?: "horizontal" | "vertical";
};

/** HTML's "valid floating-point number": no leading `+`, no surrounding whitespace, no bare
 *  trailing `.` — but a leading `.` is fine. `"10."` is invalid where `".5"` is valid. */
const VALID_FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parses an attribute exactly as the browser would, from the same string the renderer emits. */
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

/**
 * Applies the HTML value-sanitization algorithm for `input[type=range]`, returning the value the
 * browser will itself settle on: validity check with the midpoint default, clamp to `[min, max]`,
 * then snap to the nearest step from the step base.
 *
 * The readout and the thumb must agree, and only this function can make them agree. The thumb is
 * positioned by the browser from the sanitized value, while the readout is a string forge writes
 * on the Worker; `Slider` ships no client controller, so nothing reconciles the two afterwards.
 *
 * The input is the *serialized attribute set* rather than the props, so this parses byte-for-byte
 * what the browser parses — `render-to-string.ts` stringifies every attribute with `String`, and
 * anything that does not survive that round trip (an array, an object, a padded numeric string)
 * is invalid to the browser too and falls back to the range default.
 *
 * Values around 1e21 and beyond leave the range where a 15-significant-digit scrub round-trips
 * cleanly; that boundary is accepted rather than guarded, since a range control that far out is
 * not a shape the component is meant to serve.
 *
 * @internal Exported for tests only — never add this to a barrel.
 * @example
 * sanitizeRangeValue({ min: 0, max: 100, value: 150 }); // "100"
 */
export function sanitizeRangeValue(attrs: Pick<JSX.IntrinsicElements["input"], "min" | "max" | "step" | "value">): string {
  const min = toNumber(attrs.min) ?? 0;
  const maxRaw = toNumber(attrs.max) ?? 100;
  const max = maxRaw < min ? min : maxRaw; // a max below min collapses the range to a point

  const stepAny = attrs.step !== undefined && String(attrs.step).toLowerCase() === "any";
  const stepNum = toNumber(attrs.step);
  // An invalid or non-positive `step` falls back to 1 — it does not disable snapping.
  const step = stepAny ? undefined : stepNum !== undefined && stepNum > 0 ? stepNum : 1;

  const value = toNumber(attrs.value) ?? min + (max - min) / 2;
  // Step base: the `min` attribute, else the `value` attribute, else zero. The middle term is
  // load-bearing — with no `min`, a value is aligned to itself and never snaps away.
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

const SLIDER_BASE = "h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50";
const SLIDER_VERTICAL = "[writing-mode:vertical-lr] [direction:rtl] h-22 w-5";

export const Slider: FC<SliderProps> = ({ class: cls, field, output, orientation = "horizontal", "data-slot": inherited, ...props }) => {
  const resolved = field ? fieldControlProps(props, field) : props;
  const isVertical = orientation === "vertical";
  const sliderCls = cn(SLIDER_BASE, isVertical && SLIDER_VERTICAL, asClass(cls));
  const control = <input data-slot={slotToken("slider", inherited)} type='range' class={sliderCls} {...resolved} />;

  if (!output) {
    return control;
  }

  const readout = sanitizeRangeValue(resolved);
  return (
    <div data-slot='slider-wrapper' class={cn("flex gap-2", isVertical ? "flex-col items-center" : "items-center")}>
      {control}
      <output data-slot='slider-output' class='text-sm tabular-nums text-muted-foreground'>
        {readout}
      </output>
    </div>
  );
};
