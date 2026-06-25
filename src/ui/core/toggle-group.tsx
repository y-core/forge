/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { asClass, cn } from "./utils/cn";

type ToggleGroupProps = JSX.IntrinsicElements["fieldset"] & {
  orientation?: "horizontal" | "vertical";
};
type ToggleGroupItemProps = JSX.IntrinsicElements["button"] & { pressed?: boolean };

const GROUP_BASE = "flex justify-center min-w-0 border-0 m-0 p-0";

// Horizontal (default): items share borders on the horizontal axis.
// Vertical: items share borders on vertical axis; arbitrary ancestor variant overrides the horizontal defaults
const ITEM_BASE =
  "inline-flex items-center justify-center size-[34px] bg-transparent text-foreground " +
  "border border-input border-l-0 cursor-pointer " +
  "first:border-l first:rounded-l-md last:rounded-r-md " +
  "hover:bg-accent hover:text-accent-foreground [&_svg]:size-[18px] " +
  // Vertical overrides: restore full left border, remove top border, clear horizontal rounding.
  "[[data-slot=toggle-group][data-orientation=vertical]_&]:border-l " +
  "[[data-slot=toggle-group][data-orientation=vertical]_&]:border-t-0 " +
  "[[data-slot=toggle-group][data-orientation=vertical]_&]:rounded-none " +
  // Vertical first/last: top/bottom borders + rounding.
  "[[data-slot=toggle-group][data-orientation=vertical]_&]:first:border-t " +
  "[[data-slot=toggle-group][data-orientation=vertical]_&]:first:rounded-t-md " +
  "[[data-slot=toggle-group][data-orientation=vertical]_&]:last:rounded-b-md";
const ITEM_ACTIVE = "bg-primary text-primary-foreground hover:bg-primary";

const ToggleGroupRoot: FC<PropsWithChildren<ToggleGroupProps>> = ({ class: cls, orientation = "horizontal", children, ...rest }) => (
  <fieldset
    data-slot='toggle-group'
    data-orientation={orientation}
    aria-orientation={orientation}
    class={cn(GROUP_BASE, orientation === "vertical" && "flex-col", asClass(cls))}
    {...rest}>
    {children}
  </fieldset>
);

const ToggleGroupItem: FC<PropsWithChildren<ToggleGroupItemProps>> = ({ class: cls, pressed, children, ...rest }) => (
  <button
    type='button'
    data-slot='toggle-group-item'
    aria-pressed={String(pressed ?? false)}
    class={cn(ITEM_BASE, pressed && ITEM_ACTIVE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

export const ToggleGroup = Object.assign(ToggleGroupRoot, { Item: ToggleGroupItem });
