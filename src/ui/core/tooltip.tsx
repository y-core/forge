/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { type Align, type Side, stateAttrs } from "../state-attrs";
import { TOOLTIP_SCOPE } from "../toggle-contract";
import { asClass, cn } from "./utils/cn";

interface TooltipRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

interface TooltipTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Tooltip.Content` describing this trigger. */
  for: string;
  children?: JSXNode;
}

interface TooltipContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  id: string;
  side?: Side;
  align?: Align;
  children?: JSXNode;
}

const TooltipRoot: FC<TooltipRootProps> = ({ class: cls, children, ...rest }) => (
  <div data-slot='tooltip' data-scope={TOOLTIP_SCOPE} class={cn("relative inline-block", asClass(cls))} {...rest}>
    {children}
  </div>
);

/**
 * `aria-describedby`, not `aria-labelledby`: a tooltip supplements the trigger's own name rather
 * than replacing it. Getting this wrong is how a button ends up announced only by its hint.
 */
const TooltipTrigger: FC<TooltipTriggerProps> = ({ for: contentId, class: cls, children, ...rest }) => (
  <button
    type='button'
    data-slot='tooltip-trigger'
    aria-describedby={contentId}
    class={cn("cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls))}
    {...rest}>
    {children}
  </button>
);

/**
 * `popover="manual"` rather than `"auto"`: an auto popover is light-dismissed and participates in
 * the exclusive-open stack, which would close a menu the moment a tooltip appeared. A tooltip is
 * shown and hidden by its trigger's hover and focus, never by the user clicking elsewhere.
 *
 * It carries **no `tabindex`** and is never focusable — a focusable tooltip is a keyboard trap that
 * announces itself twice.
 */
const TooltipContent: FC<TooltipContentProps> = ({ id, side = "top", align = "center", class: cls, children, ...rest }) => (
  <div
    id={id}
    role='tooltip'
    data-slot='tooltip-content'
    popover='manual'
    {...stateAttrs({ open: false, side, align })}
    class={cn("z-50 w-max max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

/**
 * Compound tooltip. The trigger is described by the content; the content is a manual popover shown
 * after a short delay on hover or keyboard focus and hidden after a shorter one.
 *
 * ```tsx
 * <Tooltip>
 *   <Tooltip.Trigger for='save-tip'>Save</Tooltip.Trigger>
 *   <Tooltip.Content id='save-tip'>Writes the file to disk</Tooltip.Content>
 * </Tooltip>
 * ```
 *
 * The delays and the Escape handling arrive with the `ui/core/client` side-effect import.
 * @public
 */
export const Tooltip = Object.assign(TooltipRoot, { Trigger: TooltipTrigger, Content: TooltipContent });
