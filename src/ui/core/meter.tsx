/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface MeterRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode | undefined;
}

interface MeterTrackProps extends Omit<JSX.IntrinsicElements["meter"], "children"> {
  value: number;
}

const MeterRoot: FC<MeterRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("meter", inherited)} class={cn("flex w-full max-w-sm flex-col gap-1", cls)} {...rest}>
    {children}
  </div>
);

const MeterLabel: FC<JSX.IntrinsicElements["label"] & { for: string }> = ({
  for: target,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <label data-slot={slotToken("meter-label", inherited)} for={target} class={cn("text-sm font-medium text-foreground", cls)} {...rest}>
    {children}
  </label>
);

const MeterValue: FC<JSX.IntrinsicElements["span"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("meter-value", inherited)} class={cn("text-sm text-muted-foreground tabular-nums", cls)} {...rest}>
    {children}
  </span>
);

/** Which of the three bands a measured value reads as. @public */
export type MeterState = "optimum" | "suboptimum" | "poor";

// `Number.isFinite`, not `?? fallback`: the props are typed `number`, so what actually arrives from
// a computed value is `NaN`, and every comparison against it is false.
const toNumber = (raw: number | undefined, fallback: number): number => (raw !== undefined && Number.isFinite(raw) ? raw : fallback);

const clamp = (n: number, low: number, high: number): number => Math.min(Math.max(n, low), high);

// The state is computed here rather than left to the engine because no browser exposes it to CSS in
// a form both of them agree on, and the fill's colour is the whole reading. The clamping order is
// HTML's own, so the band this names is the band the element itself is in.
/** Which band the value falls in, by HTML's meter algorithm — the fill colour follows it. @internal */
export function meterState(attrs: Pick<MeterTrackProps, "value" | "min" | "max" | "low" | "high" | "optimum">): MeterState {
  const min = toNumber(attrs.min, 0);
  const max = Math.max(toNumber(attrs.max, 1), min);
  const value = clamp(toNumber(attrs.value, 0), min, max);
  const low = clamp(toNumber(attrs.low, min), min, max);
  const high = clamp(toNumber(attrs.high, max), low, max);
  const optimum = clamp(toNumber(attrs.optimum, (min + max) / 2), min, max);

  // `<=` and `>=`, matching HTML's own `GetGaugeRegion`: a value sitting exactly on `low` is in the
  // low region, not between the two, and the same at `high`.
  const band = (n: number): "low" | "medium" | "high" => (n <= low ? "low" : n >= high ? "high" : "medium");
  const best = band(optimum);
  const here = band(value);
  if (here === best) return "optimum";
  return best === "medium" || here === "medium" ? "suboptimum" : "poor";
}

const MeterTrack: FC<MeterTrackProps> = ({ class: cls, "data-slot": inherited, ...rest }) => (
  <meter
    data-slot={slotToken("meter-track", inherited)}
    data-state={meterState(rest)}
    class={cn("h-2 w-full rounded-selector bg-border", cls)}
    {...rest}
  />
);

/** A scalar measurement within a known range, on native `<meter>`. @public */
export const Meter = Object.assign(MeterRoot, { Label: MeterLabel, Value: MeterValue, Track: MeterTrack });
