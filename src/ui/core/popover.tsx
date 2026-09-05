/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { invokerAttrs, POPOVER_SCOPE } from "../contracts/overlay-contract";
import { type PhysicalSide, stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface PopoverProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode | undefined;
}

type PopoverAlign = "start" | "center" | "end";

interface PopoverTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Popover.Content` this trigger toggles — its `commandfor` target. */
  for: string;
  children?: JSXNode | undefined;
}

interface PopoverContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  /** Element id — the `commandfor` target named by the matching `Popover.Trigger`. */
  id: string;
  align?: PopoverAlign | undefined;
  side?: PhysicalSide | undefined;
  children?: JSXNode | undefined;
}

const PopoverRoot: FC<PopoverProps> = ({ class: cls, children, "data-slot": inherited, ...props }) => (
  <div data-slot={slotToken("popover", inherited)} class={cn("relative inline-block", cls)} {...props}>
    {children}
  </div>
);

const PopoverTrigger: FC<PopoverTriggerProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...props }) => (
  <button
    type='button'
    data-slot={slotToken("popover-trigger", inherited)}
    command='toggle-popover'
    commandfor={target}
    {...invokerAttrs(target)}
    class={cn("cursor-pointer list-none focus-ring", cls)}
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
    class={cn("z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md", cls)}
    {...rest}>
    {children}
  </div>
);

/** Compound popover built on the native Popover + Invoker Commands APIs, linked by the trigger's `for` and the content's `id`. @public */
export const Popover = Object.assign(PopoverRoot, { Trigger: PopoverTrigger, Content: PopoverContent });
