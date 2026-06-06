import type { Child, FC, JSX } from "../../jsx/types";
import { asClass, cn } from "./utils/cn";

interface PopoverProps extends Omit<JSX.IntrinsicElements["details"], "children"> {
  children?: Child;
}

const PopoverRoot: FC<PopoverProps> = ({ class: cls, children, ...props }) => (
  <details data-slot='popover' class={cn("relative inline-block", asClass(cls))} {...props}>
    {children}
  </details>
);

interface PopoverTriggerProps extends Omit<JSX.IntrinsicElements["summary"], "children"> {
  children?: Child;
}

const PopoverTrigger: FC<PopoverTriggerProps> = ({ class: cls, children, ...props }) => (
  <summary
    data-slot='popover-trigger'
    class={cn("list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls))}
    {...props}>
    {children}
  </summary>
);

type PopoverAlign = "start" | "center" | "end";
type PopoverSide = "bottom" | "top";

interface PopoverContentProps {
  align?: PopoverAlign;
  side?: PopoverSide;
  class?: string;
  children?: Child;
}

const alignClasses: Record<PopoverAlign, string> = { start: "left-0", center: "left-1/2 -translate-x-1/2", end: "right-0" };

const sideClasses: Record<PopoverSide, string> = { bottom: "top-full mt-1.5", top: "bottom-full mb-1.5" };

const PopoverContent: FC<PopoverContentProps> = ({ align = "start", side = "bottom", class: cls, children }) => (
  <div
    data-slot='popover-content'
    data-align={align}
    data-side={side}
    class={cn(
      "absolute z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md",
      alignClasses[align],
      sideClasses[side],
      cls,
    )}>
    {children}
  </div>
);

export const Popover = Object.assign(PopoverRoot, { Trigger: PopoverTrigger, Content: PopoverContent });
