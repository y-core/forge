/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { type ButtonSize, buttonVariants } from "./button";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

/** Whether one item may be pressed at a time, or several. @public */
export type ToggleGroupType = "single" | "multiple";

type ToggleGroupProps = JSX.IntrinsicElements["fieldset"] & { orientation?: "horizontal" | "vertical"; type?: ToggleGroupType };
type ToggleGroupItemProps = JSX.IntrinsicElements["button"] & { pressed?: boolean; size?: ButtonSize };

const GROUP_BASE = "flex justify-center min-w-0 border-0 m-0 p-0";

const ITEM_BASE =
  "bg-transparent border border-input border-l-0 cursor-pointer " +
  "rounded-none first:border-l first:rounded-l-md last:rounded-r-md " +
  "hover:text-accent-foreground " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:border-l " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:border-t-0 " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:rounded-none " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:first:border-t " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:first:rounded-t-md " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:last:rounded-b-md";

// Keyed on `data-pressed` — the only thing `bindGroup` flips — so a render-time class cannot freeze the paint.
const ITEM_PRESSED = "data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary";

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

/** A segmented row or column of toggle buttons, with an `Item` subcomponent. @public */
export const ToggleGroup = Object.assign(ToggleGroupRoot, { Item: ToggleGroupItem });
