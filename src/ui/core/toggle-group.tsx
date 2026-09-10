/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { TOGGLE_GROUP_SCOPE } from "../contracts/toggle-contract";
import type { Orientation } from "../contracts/types";
import type { Size } from "../contracts/types";
import { buttonVariants } from "./button";
import type { ToggleGroupType } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { PRESSED_PAINT } from "./utils/recipes";

type ToggleGroupProps = JSX.IntrinsicElements["fieldset"] & { orientation?: Orientation | undefined; type?: ToggleGroupType | undefined };

// `size` is omitted from the input's own attributes before being re-declared: `<input size>` is a
// character count, and intersecting it with the button scale would leave the prop unusable as either.
type ToggleGroupItemProps = Omit<JSX.IntrinsicElements["input"], "type" | "children" | "size"> & {
  /** Shared `name` that makes these items one group — repeated per item, as `RadioGroup.Item` does. */
  name: string;
  value: string;
  /** Must match the group's `type`: `single` renders a radio, `multiple` a checkbox. @default "single" */
  type?: ToggleGroupType | undefined;
  pressed?: boolean | undefined;
  size?: Size | undefined;
};

const GROUP_BASE = "flex justify-center min-w-0 border-0 m-0 p-0";

const ITEM_BASE =
  "bg-transparent border-input border-s-0 cursor-pointer " +
  "rounded-none first:rounded-s-field first:border-s last:rounded-e-field " +
  "hover:text-accent-foreground " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:border-s " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:border-t-0 " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:rounded-none " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:first:border-t " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:first:rounded-t-field " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&]:last:rounded-b-field";

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
    data-scope={TOGGLE_GROUP_SCOPE}
    {...(type === "multiple" ? { "data-multiple": "" } : {})}
    {...stateAttrs({ orientation })}
    class={cn(GROUP_BASE, orientation === "vertical" && "flex-col", cls)}
    {...rest}>
    {children}
  </fieldset>
);

const ToggleGroupItem: FC<PropsWithChildren<ToggleGroupItemProps>> = ({
  class: cls,
  name,
  value,
  type = "single",
  pressed,
  size = "sm",
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <label
    data-slot='toggle-group-item'
    class={buttonVariants({ tone: "neutral", appearance: "ghost", size, class: cn(ITEM_BASE, PRESSED_PAINT, cls) })}>
    {/* A radio group is one tab stop with native arrow-key navigation; a checkbox group is not, which
        is why only `type="multiple"` mounts roving focus. */}
    <input
      data-slot={slotToken("toggle-group-input", inherited)}
      type={type === "multiple" ? "checkbox" : "radio"}
      name={name}
      value={value}
      class='sr-only'
      {...(pressed ? { checked: true } : {})}
      {...rest}
    />
    {children}
  </label>
);

/** A segmented row or column of toggle buttons backed by native radios or checkboxes, with an `Item` subcomponent. @public */
export const ToggleGroup = Object.assign(ToggleGroupRoot, { Item: ToggleGroupItem });
