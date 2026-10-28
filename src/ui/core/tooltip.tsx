/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { isValidElement } from "../../render/jsx/element";
import type { FC, JSX, JSXNode } from "../../render/jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { TOOLTIP_SCOPE } from "../contracts/toggle-contract";
import type { Align, PhysicalSide } from "../contracts/types";
import { buttonBox } from "./button";
import { mergeIdRefs } from "./field";
import { cloneAsChild, slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface TooltipRootProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  children?: JSXNode | undefined;
}

interface TooltipTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Tooltip.Content` this trigger points at. */
  for: string;
  /** Whether the content describes the trigger or is its accessible name; defaults to `"description"`. */
  kind?: "description" | "label" | undefined;
  /** Render onto the caller's own element instead of forge's, which must be exactly one JSX element child. */
  asChild?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface TooltipContentProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  id: string;
  side?: PhysicalSide | undefined;
  align?: Align | undefined;
  children?: JSXNode | undefined;
}

const TooltipRoot: FC<TooltipRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("tooltip", inherited)} data-scope={TOOLTIP_SCOPE} class={cn("relative inline-block", cls)} {...rest}>
    {children}
  </span>
);

const NAME_PROPS = ["aria-label", "aria-labelledby"] as const;

function assertUnnamedTrigger(own: Record<string, unknown>, child: JSXNode): void {
  const childProps = isValidElement(child) ? child.props : {};
  const named = NAME_PROPS.find((prop) => own[prop] !== undefined || childProps[prop] !== undefined);
  if (!named) return;
  throw new Error(
    `Tooltip.Trigger with kind="label" cannot also carry ${named}: the tooltip content is the trigger's name, and two names leave one unannounced. ` +
      `Drop ${named}, or use kind="description" to keep it as the name.`,
  );
}

const TooltipTrigger: FC<TooltipTriggerProps> = ({
  for: contentId,
  kind = "description",
  asChild = false,
  class: cls,
  children,
  "data-slot": inherited,
  "aria-describedby": ownDescribedBy,
  ...rest
}) => {
  if (kind === "label") assertUnnamedTrigger(rest, asChild ? children : null);
  const inert = rest.disabled === true || (asChild && isValidElement(children) && children.props.disabled === true);
  const childDescribedBy = asChild && isValidElement(children) ? children.props["aria-describedby"] : undefined;
  const describedBy = mergeIdRefs(typeof childDescribedBy === "string" ? childDescribedBy : undefined, [
    ownDescribedBy,
    kind === "label" ? undefined : contentId,
  ]);
  const attrs = {
    ...(kind === "label" ? { "aria-labelledby": contentId } : {}),
    ...(describedBy !== undefined ? { "aria-describedby": describedBy } : {}),
    ...rest,
    ...(inert ? { disabled: undefined, "aria-disabled": "true" as const, ...stateAttrs({ disabled: true }) } : {}),
  };
  const slot = slotToken("tooltip-trigger", inherited);

  if (asChild) {
    return cloneAsChild(children, {
      slot,
      class: cn("cursor-default focus-ring", cls),
      props: attrs,
      type: rest.type,
      message:
        "Tooltip.Trigger with asChild requires exactly one JSX element child (e.g. <button> or <a>); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<TooltipTriggerProps>>;
  }

  return (
    <button type='button' data-slot={slot} class={cn(buttonBox({ size: "sm" }), "border-transparent", "cursor-default", cls)} {...attrs}>
      {children}
    </button>
  );
};

const TooltipContent: FC<TooltipContentProps> = ({ id, side = "top", align = "center", class: cls, children, "data-slot": inherited, ...rest }) => (
  <span
    id={id}
    role='tooltip'
    data-slot={slotToken("tooltip-content", inherited)}
    popover='hint'
    {...stateAttrs({ side, align })}
    class={cn("z-50 w-max max-w-xs rounded-field bg-foreground px-2 py-1 text-xs text-background shadow-md", cls)}
    {...rest}>
    {children}
  </span>
);

/** Compound tooltip whose trigger is described or named by a hint popover shown on hover or keyboard focus. @public */
export const Tooltip = Object.assign(TooltipRoot, { Trigger: TooltipTrigger, Content: TooltipContent });
