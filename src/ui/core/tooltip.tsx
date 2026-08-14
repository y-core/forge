/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { type Align, type Side, stateAttrs } from "../contracts/state-attrs";
import { TOOLTIP_SCOPE } from "../contracts/toggle-contract";
import { cloneAsChild, slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface TooltipRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

interface TooltipTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Tooltip.Content` describing this trigger. */
  for: string;
  /** Render onto the caller's own element instead of forge's, which must be exactly one JSX element child. */
  asChild?: boolean;
  children?: JSXNode;
}

/** The stylesheet's placement matrix is physical-only, so a logical side would match no rule and silently centre the popup. */
type TooltipSide = Exclude<Side, "block-start" | "block-end" | "inline-start" | "inline-end">;

interface TooltipContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  id: string;
  side?: TooltipSide;
  align?: Align;
  children?: JSXNode;
}

const TooltipRoot: FC<TooltipRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("tooltip", inherited)} data-scope={TOOLTIP_SCOPE} class={cn("relative inline-block", asClass(cls))} {...rest}>
    {children}
  </div>
);

const TooltipTrigger: FC<TooltipTriggerProps> = ({ for: contentId, asChild = false, class: cls, children, "data-slot": inherited, ...rest }) => {
  const className = cn("cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls));
  // `mountTooltip` resolves the content by `aria-describedby`, so dropping it disables the tooltip entirely.
  const attrs = { "aria-describedby": contentId, ...rest };
  const slot = slotToken("tooltip-trigger", inherited);

  if (asChild) {
    return cloneAsChild(children, {
      slot,
      class: className,
      props: attrs,
      type: "button",
      ...(typeof rest.disabled === "boolean" ? { disabled: rest.disabled } : {}),
      message:
        "Tooltip.Trigger with asChild requires exactly one JSX element child (e.g. <button> or <a>); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<TooltipTriggerProps>>;
  }

  return (
    <button type='button' data-slot={slot} class={className} {...attrs}>
      {children}
    </button>
  );
};

const TooltipContent: FC<TooltipContentProps> = ({ id, side = "top", align = "center", class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    id={id}
    role='tooltip'
    data-slot={slotToken("tooltip-content", inherited)}
    popover='manual'
    {...stateAttrs({ open: false, side, align })}
    class={cn("z-50 w-max max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

/** Compound tooltip whose trigger is described by a manual popover shown on hover or keyboard focus. @public */
export const Tooltip = Object.assign(TooltipRoot, { Trigger: TooltipTrigger, Content: TooltipContent });
