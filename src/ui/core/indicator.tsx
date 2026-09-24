/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import type { IndicatorPlacement } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { cva } from "./utils/cva";

type IndicatorItemProps = JSX.IntrinsicElements["span"] & { placement?: IndicatorPlacement | undefined };

const indicatorItem = cva({
  base: "absolute z-10",
  variants: {
    placement: {
      "top-start": "start-0 top-0 -translate-x-1/2 -translate-y-1/2",
      "top-end": "end-0 top-0 translate-x-1/2 -translate-y-1/2",
      "bottom-start": "start-0 bottom-0 -translate-x-1/2 translate-y-1/2",
      "bottom-end": "end-0 bottom-0 translate-x-1/2 translate-y-1/2",
    },
  },
  defaultVariants: { placement: "top-end" },
});

const IndicatorRoot: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("indicator", inherited)} class={cn("relative inline-flex", cls)} {...rest}>
    {children}
  </div>
);

const IndicatorItem: FC<IndicatorItemProps> = ({ placement = "top-end", class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("indicator-item", inherited)} data-placement={placement} class={cn(indicatorItem({ placement }), cls)} {...rest}>
    {children}
  </span>
);

/** Positions a badge or status dot on a corner of the content it wraps, with an `Item` subcomponent. @public */
export const Indicator = Object.assign(IndicatorRoot, { Item: IndicatorItem });
