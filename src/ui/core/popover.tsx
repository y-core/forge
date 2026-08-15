/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { invokerAttrs, POPOVER_SCOPE } from "../contracts/overlay-contract";
import { stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface PopoverProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

type PopoverAlign = "start" | "center" | "end";
type PopoverSide = "bottom" | "top";

interface PopoverTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  id: string;
  children?: JSXNode;
}

interface PopoverContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  id: string;
  align?: PopoverAlign;
  side?: PopoverSide;
  children?: JSXNode;
}

const PopoverRoot: FC<PopoverProps> = ({ class: cls, children, "data-slot": inherited, ...props }) => (
  <div data-slot={slotToken("popover", inherited)} class={cn("relative inline-block", asClass(cls))} {...props}>
    {children}
  </div>
);

const PopoverTrigger: FC<PopoverTriggerProps> = ({ id, class: cls, children, "data-slot": inherited, ...props }) => (
  <button
    type='button'
    data-slot={slotToken("popover-trigger", inherited)}
    command='toggle-popover'
    commandfor={id}
    {...invokerAttrs(id)}
    class={cn("list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls))}
    {...props}>
    {children}
  </button>
);

const PopoverContent: FC<PopoverContentProps> = ({
  id,
  align = "start",
  side = "bottom",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <div
    id={id}
    data-slot={slotToken("popover-content", inherited)}
    data-scope={POPOVER_SCOPE}
    popover='auto'
    {...stateAttrs({ side, align })}
    class={cn("z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md", cls)}
    {...rest}>
    {children}
  </div>
);

/** Compound popover built on the native Popover + Invoker Commands APIs, linked by a shared `id`. @public */
export const Popover = Object.assign(PopoverRoot, { Trigger: PopoverTrigger, Content: PopoverContent });
