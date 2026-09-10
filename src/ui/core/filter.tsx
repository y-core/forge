/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import type { Size } from "../contracts/types";
import { buttonVariants } from "./button";
import type { FilterAppearance } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { PRESSED_PAINT } from "./utils/recipes";

interface FilterProps extends Omit<JSX.IntrinsicElements["form"], "children"> {
  /** Renders a `<fieldset>` for a filter inside the consumer's own form; the reset then clears that whole form. */
  nested?: boolean | undefined;
  children?: JSXNode | undefined;
}

// `size` is omitted from the input's own attributes before being re-declared: `<input size>` is a
// character count, and intersecting it with the button scale would leave the prop unusable as either.
interface FilterItemProps extends Omit<JSX.IntrinsicElements["input"], "type" | "children" | "size"> {
  /** Shared `name` that makes these chips one group — repeated per chip, as `ToggleGroup.Item` does. */
  name: string;
  value: string;
  /** The initial choice; the reset restores it. */
  checked?: boolean | undefined;
  size?: Size | undefined;
  appearance?: FilterAppearance | undefined;
  children?: JSXNode | undefined;
}

interface FilterResetProps extends Omit<JSX.IntrinsicElements["button"], "type" | "children"> {
  size?: Size | undefined;
  children?: JSXNode | undefined;
}

const ROOT = "group/filter m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0";

// The chosen chip stays visible and its siblings hide, all on the form's own `:has(:checked)`; the
// stacked variant outranks the chip's own `inline-flex` whatever order Tailwind emits the two in.
const ITEM_STATE = "cursor-pointer has-[:checked]:border-primary group-has-[:checked]/filter:not-has-[:checked]:hidden";

const RESET_STATE = "hidden group-has-[:checked]/filter:inline-flex";

const FilterRoot: FC<FilterProps> = ({ nested = false, class: cls, children, "data-slot": inherited, ...rest }) => {
  const Tag = nested ? "fieldset" : "form";
  return (
    <Tag data-slot={slotToken("filter", inherited)} class={cn(ROOT, cls)} {...rest}>
      {children}
    </Tag>
  );
};

const FilterItem: FC<FilterItemProps> = ({
  name,
  value,
  checked = false,
  size = "sm",
  appearance = "ghost",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <label data-slot='filter-item' class={buttonVariants({ tone: "neutral", appearance, size, class: cn(ITEM_STATE, PRESSED_PAINT, cls) })}>
    <input
      data-slot={slotToken("filter-input", inherited)}
      type='radio'
      name={name}
      value={value}
      class='sr-only'
      {...(checked ? { checked: true } : {})}
      {...rest}
    />
    {children}
  </label>
);

const FilterReset: FC<FilterResetProps> = ({ size = "sm", class: cls, children, "data-slot": inherited, "aria-label": ariaLabel, ...rest }) => (
  <button
    type='reset'
    data-slot={slotToken("filter-reset", inherited)}
    aria-label={ariaLabel}
    class={buttonVariants({ tone: "neutral", appearance: "ghost", size, shape: "circle", class: cn(RESET_STATE, cls) })}
    {...rest}>
    {children ?? [ariaLabel === undefined ? <span class='sr-only'>Clear</span> : null, <span aria-hidden='true'>×</span>]}
  </button>
);

/** A one-of-N facet chooser: native radios painted as chips, the chosen one left standing beside a reset that clears it. @public */
export const Filter = Object.assign(FilterRoot, { Item: FilterItem, Reset: FilterReset });
