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
  /**
   * Render onto the caller's own element instead of forge's. Same contract as `core/Button`'s:
   * exactly one JSX element child, or it throws.
   *
   * **The case this exists for is an app adding tooltips to controls it already has.** A toolbar
   * button carrying its own selector hooks and its own delegated action must stay *one* element —
   * wrapping it in forge's trigger would put a second button around it, breaking every selector that
   * addresses it and giving the row two focus stops.
   */
  asChild?: boolean;
  children?: JSXNode;
}

/** The tooltip's stylesheet is a complete *physical* matrix, so a logical side would match no rule
 * at all and the popup would fall back to centred on its anchor. Projecting the subset makes that
 * unrepresentable rather than a silent placement bug. */
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

/**
 * `aria-describedby`, not `aria-labelledby`: a tooltip supplements the trigger's own name rather
 * than replacing it. Getting this wrong is how a button ends up announced only by its hint.
 */
const TooltipTrigger: FC<TooltipTriggerProps> = ({ for: contentId, asChild = false, class: cls, children, "data-slot": inherited, ...rest }) => {
  const className = cn("cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls));
  // `aria-describedby` is also what `mountTooltip` resolves the content by, so it is part of the
  // wiring rather than only of the announcement — an `asChild` trigger that lost it would be a
  // control with a tooltip that never shows.
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

/**
 * `popover="manual"` rather than `"auto"`: an auto popover is light-dismissed and participates in
 * the exclusive-open stack, which would close a menu the moment a tooltip appeared. A tooltip is
 * shown and hidden by its trigger's hover and focus, never by the user clicking elsewhere.
 *
 * It carries **no `tabindex`** and is never focusable — a focusable tooltip is a keyboard trap that
 * announces itself twice.
 */
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
