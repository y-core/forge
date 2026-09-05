/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cva } from "./utils/cva";

/** The edge the layers behind the first child fan out towards. @public */
export type StackPlacement = "top" | "bottom" | "start" | "end";

interface StackProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  placement?: StackPlacement | undefined;
  children?: JSXNode | undefined;
}

// One cell for every layer: the first child is the readable one and the next two peek out behind it.
const stackVariants = cva({
  base:
    "grid place-items-center [&>*]:w-full [&>*]:[grid-area:1/1] " +
    "[&>*:nth-child(1)]:z-20 [&>*:nth-child(2)]:z-10 [&>*:nth-child(2)]:scale-95 [&>*:nth-child(2)]:opacity-90 " +
    "[&>*:nth-child(3)]:z-0 [&>*:nth-child(3)]:scale-90 [&>*:nth-child(3)]:opacity-80",
  variants: {
    placement: {
      top: "[&>*:nth-child(2)]:-translate-y-2 [&>*:nth-child(3)]:-translate-y-4",
      bottom: "[&>*:nth-child(2)]:translate-y-2 [&>*:nth-child(3)]:translate-y-4",
      start:
        "[&>*:nth-child(2)]:-translate-x-2 [&>*:nth-child(3)]:-translate-x-4 " +
        "rtl:[&>*:nth-child(2)]:translate-x-2 rtl:[&>*:nth-child(3)]:translate-x-4",
      end:
        "[&>*:nth-child(2)]:translate-x-2 [&>*:nth-child(3)]:translate-x-4 " +
        "rtl:[&>*:nth-child(2)]:-translate-x-2 rtl:[&>*:nth-child(3)]:-translate-x-4",
    },
  },
  defaultVariants: { placement: "bottom" },
});

/** Layers its children in one grid cell, the first on top and up to two more fanned out behind it. @public */
export const Stack: FC<StackProps> = ({ placement = "bottom", class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("stack", inherited)} data-placement={placement} class={stackVariants({ placement, class: cls })} {...rest}>
    {children}
  </div>
);
