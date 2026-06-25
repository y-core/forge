/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { asClass, cn } from "./utils/cn";

type ToggleGroupProps = JSX.IntrinsicElements["fieldset"];
type ToggleGroupItemProps = JSX.IntrinsicElements["button"] & { pressed?: boolean };

const GROUP_BASE = "flex justify-center min-w-0 border-0 m-0 p-0";
const ITEM_BASE =
  "inline-flex items-center justify-center size-[34px] bg-transparent text-foreground " +
  "border border-input border-l-0 cursor-pointer " +
  "first:border-l first:rounded-l-md last:rounded-r-md " +
  "hover:bg-accent hover:text-accent-foreground [&_svg]:size-[18px]";
const ITEM_ACTIVE = "bg-primary text-primary-foreground hover:bg-primary";

const ToggleGroupRoot: FC<PropsWithChildren<ToggleGroupProps>> = ({ class: cls, children, ...rest }) => (
  <fieldset data-slot='toggle-group' class={cn(GROUP_BASE, asClass(cls))} {...rest}>
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
