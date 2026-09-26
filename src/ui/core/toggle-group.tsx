/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { nameAttrs } from "../contracts/naming";
import { stateAttrs } from "../contracts/state-attrs";
import { TOGGLE_GROUP_SCOPE } from "../contracts/toggle-contract";
import type { ContainerNaming, Orientation } from "../contracts/types";
import type { Size } from "../contracts/types";
import { buttonVariants } from "./button";
import type { ToggleGroupType } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { PRESSED_PAINT } from "./utils/recipes";

type ToggleGroupProps = ContainerNaming &
  JSX.IntrinsicElements["fieldset"] & { orientation?: Orientation | undefined; type?: ToggleGroupType | undefined };

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

const GROUP_BASE = "group/toggle-group flex justify-center min-w-0 border-0 m-0 p-0";

const ITEM_BASE =
  "bg-transparent border-input cursor-pointer rounded-none hover:text-accent-foreground " +
  "group-data-[orientation=horizontal]/toggle-group:border-s-0 " +
  "group-data-[orientation=horizontal]/toggle-group:first:border-s " +
  "group-data-[orientation=horizontal]/toggle-group:first:rounded-s-field " +
  "group-data-[orientation=horizontal]/toggle-group:last:rounded-e-field " +
  "group-data-[orientation=vertical]/toggle-group:border-t-0 " +
  "group-data-[orientation=vertical]/toggle-group:first:border-t " +
  "group-data-[orientation=vertical]/toggle-group:first:rounded-t-field " +
  "group-data-[orientation=vertical]/toggle-group:last:rounded-b-field";

// A `<fieldset>` with no legend is an unnamed group, and this one renders none: the name is required
// rather than optional so a group cannot announce itself as "group" and nothing else.
const ToggleGroupRoot: FC<PropsWithChildren<ToggleGroupProps>> = ({
  class: cls,
  orientation = "horizontal",
  type = "single",
  label,
  labelledby,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <fieldset
    {...nameAttrs({ label, labelledby })}
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
