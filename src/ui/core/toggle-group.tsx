/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { type ButtonSize, buttonVariants } from "./button";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

/** Whether one item may be pressed at a time, or several. Drives both the group's announced
 * semantics and how `bindGroup` reconciles a click across the group. @public */
export type ToggleGroupType = "single" | "multiple";

type ToggleGroupProps = JSX.IntrinsicElements["fieldset"] & { orientation?: "horizontal" | "vertical"; type?: ToggleGroupType };
type ToggleGroupItemProps = JSX.IntrinsicElements["button"] & { pressed?: boolean; size?: ButtonSize };

const GROUP_BASE = "flex justify-center min-w-0 border-0 m-0 p-0";

// Horizontal (default): items share borders on the horizontal axis.
// Vertical: items share borders on vertical axis; arbitrary ancestor variant overrides the horizontal defaults
const ITEM_BASE =
  "bg-transparent border border-input border-l-0 cursor-pointer " +
  // A strip has square interior corners: the shared button radius is cleared, and only the two ends
  // of the strip get it back.
  "rounded-none first:border-l first:rounded-l-md last:rounded-r-md " +
  "hover:text-accent-foreground " +
  // Vertical overrides: restore full left border, remove top border, clear horizontal rounding.
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:border-l " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:border-t-0 " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:rounded-none " +
  // Vertical first/last: top/bottom borders + rounding.
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:first:border-t " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:first:rounded-t-md " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:last:rounded-b-md";

// Keyed on `data-pressed`, the attribute `bindGroup` flips, rather than baked in at render time: a
// static class is fixed for the element's life, so the paint would stay on whichever item the server
// rendered pressed no matter what the user clicked.
const ITEM_PRESSED = "data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary";

/**
 * A group of toggle buttons.
 *
 * **No `role` at all, where it was previously hardcoded to `toolbar` for every group.** That was
 * wrong for the great majority of them — a screen reader announced a segmented control as a toolbar
 * and offered the wrong interaction model — and it is also unnecessary: `<fieldset>` already has an
 * implicit `group` role. A widget that really is a toolbar now uses `core/toolbar.tsx`, which brings
 * the keyboard behaviour the role promises. `aria-orientation` went with it: ARIA does not define it
 * for `group`, and `data-orientation` carries the axis for styling.
 *
 * `type` states what kind of group this is, published as `data-multiple` — present exactly when
 * several items may be pressed at once. That is what `bindGroup` reads to decide whether a click
 * replaces the pressed item or adds to it.
 */
const ToggleGroupRoot: FC<PropsWithChildren<ToggleGroupProps>> = ({
  class: cls,
  orientation = "horizontal",
  type = "single",
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <fieldset
    data-slot={slotToken("toggle-group", inherited)}
    {...(type === "multiple" ? { "data-multiple": "" } : {})}
    {...stateAttrs({ orientation })}
    class={cn(GROUP_BASE, orientation === "vertical" && "flex-col", asClass(cls))}
    {...rest}>
    {children}
  </fieldset>
);

/** A toggle in the strip. Its box is `core/Button`'s ghost box — same sizes, same focus ring —
 * with the strip's shared borders and pressed paint layered over it. */
const ToggleGroupItem: FC<PropsWithChildren<ToggleGroupItemProps>> = ({
  class: cls,
  pressed,
  size = "sm",
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <button
    type='button'
    data-slot={slotToken("toggle-group-item", inherited)}
    {...stateAttrs({ pressed: pressed ?? false })}
    aria-pressed={pressed ?? false}
    class={buttonVariants({ variant: "ghost", size, class: cn(ITEM_BASE, ITEM_PRESSED, asClass(cls)) })}
    {...rest}>
    {children}
  </button>
);

export const ToggleGroup = Object.assign(ToggleGroupRoot, { Item: ToggleGroupItem });
