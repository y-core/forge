/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface MeterRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

interface MeterTrackProps extends Omit<JSX.IntrinsicElements["meter"], "children"> {
  value: number;
}

const MeterRoot: FC<MeterRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("meter", inherited)} class={cn("flex w-full max-w-sm flex-col gap-1", asClass(cls))} {...rest}>
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
  <label data-slot={slotToken("meter-label", inherited)} for={target} class={cn("text-sm font-medium text-foreground", asClass(cls))} {...rest}>
    {children}
  </label>
);

const MeterValue: FC<JSX.IntrinsicElements["span"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("meter-value", inherited)} class={cn("text-sm tabular-nums text-muted-foreground", asClass(cls))} {...rest}>
    {children}
  </span>
);

const MeterTrack: FC<MeterTrackProps> = ({ class: cls, "data-slot": inherited, ...rest }) => (
  <meter data-slot={slotToken("meter-track", inherited)} class={cn("h-2 w-full", asClass(cls))} {...rest} />
);

/** A scalar measurement within a known range, on native `<meter>`. @public */
export const Meter = Object.assign(MeterRoot, { Label: MeterLabel, Value: MeterValue, Track: MeterTrack });
