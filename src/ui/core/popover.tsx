/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import type { FC, JSX, JSXNode } from "../../render/jsx/types";
import { nameAttrs } from "../contracts/naming";
import { invokerAttrs, POPOVER_SCOPE } from "../contracts/overlay-contract";
import { stateAttrs } from "../contracts/state-attrs";
import type { InvokerShape, PhysicalSide } from "../contracts/types";
import { buttonBox } from "./button";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface PopoverProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  children?: JSXNode | undefined;
}

type PopoverAlign = "start" | "center" | "end";

interface PopoverTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Popover.Content` this trigger toggles — its `commandfor` target. */
  for: string;
  /** `"icon"` squares the box and drops its inline padding, for a child that is only an icon. */
  shape?: InvokerShape | undefined;
  children?: JSXNode | undefined;
}

type PopoverContentBase = Omit<JSX.IntrinsicElements["span"], "children" | "role">;

/** A panel is `role="dialog"`, which is `nameFrom: author`, so a name is required rather than optional. */
type PopoverContentProps = PopoverContentBase & {
  /** Element id — the `commandfor` target named by the matching `Popover.Trigger`. */
  id: string;
  align?: PopoverAlign | undefined;
  side?: PhysicalSide | undefined;
  children?: JSXNode | undefined;
} & ({ label: string; labelledby?: undefined } | { labelledby: string; label?: undefined });

const PopoverRoot: FC<PopoverProps> = ({ class: cls, children, "data-slot": inherited, ...props }) => (
  <span data-slot={slotToken("popover", inherited)} class={cn("relative inline-block", cls)} {...props}>
    {children}
  </span>
);

const PopoverTrigger: FC<PopoverTriggerProps> = ({ for: target, shape, class: cls, children, "data-slot": inherited, ...props }) => (
  <button
    type='button'
    data-slot={slotToken("popover-trigger", inherited)}
    command='toggle-popover'
    commandfor={target}
    {...invokerAttrs(target, "dialog")}
    class={cn(buttonBox({ size: "sm", shape }), "border-transparent", "cursor-pointer list-none", cls)}
    {...props}>
    {children}
  </button>
);

const PopoverContent: FC<PopoverContentProps> = ({
  id,
  align = "start",
  side = "bottom",
  label,
  labelledby,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <span
    id={id}
    role='dialog'
    {...nameAttrs({ label, labelledby })}
    data-slot={slotToken("popover-content", inherited)}
    data-scope={POPOVER_SCOPE}
    popover='auto'
    {...stateAttrs({ side, align })}
    class={cn("z-50 min-w-32 rounded-box border-field border-border bg-popover p-1 text-popover-foreground shadow-md", cls)}
    {...rest}>
    {children}
  </span>
);

/** Compound popover built on the native Popover + Invoker Commands APIs, linked by the trigger's `for` and the content's `id`. @public */
export const Popover = Object.assign(PopoverRoot, { Trigger: PopoverTrigger, Content: PopoverContent });
