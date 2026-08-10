/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { FieldDescription, FieldError, fieldDescribedBy, fieldId } from "./field";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type GroupOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface CheckboxGroupRootProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  /** Shared `name` for every checkbox in the group — also the key its ids are derived from. */
  name: string;
  /** Distinguishes two same-named groups on one page. Ids are derived from `name` alone without it,
   * so both groups would emit the same id for every item as well as for the description and error.
   * Pass the same value to every `Item`, and to the group's `Description` and `Error`. */
  scope?: string;
  /** A description element renders for this group. Off by default: `aria-describedby` may only name
   * an element that is actually on the page, and a dangling IDREF is an error assistive technology
   * reports rather than ignores. `<CheckboxGroup.Description>` must be given the same `name` (and
   * `scope`) for the id it emits to match the one named here. */
  description?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  orientation?: GroupOrientation;
  children?: JSXNode;
}

interface CheckboxGroupItemProps extends Omit<JSX.IntrinsicElements["input"], "children" | "type"> {
  name: string;
  value: string;
  /** Must match the group's `scope` — see {@link CheckboxGroupRootProps.scope}. */
  scope?: string;
  children?: JSXNode;
}

/** Per-item id, derived rather than passed: the group and the item cannot see each other, and a
 * hand-written id in two places is the drift `field.tsx`'s helpers already exist to prevent.
 *
 * This id is declared but never referenced — the input is wrapped in its `<label>`, so no `for`
 * names it, and a `value` containing whitespace is caller data that round-trips verbatim. Adding an
 * IDREF to it means gating it through `field.tsx`'s id-token predicate first. */
function itemId(name: string, value: string, scope?: string): string {
  return `${fieldId(name, scope)}-${value}`;
}

const CheckboxGroupRoot: FC<PropsWithChildren<CheckboxGroupRootProps>> = ({
  name,
  scope,
  description = false,
  invalid = false,
  disabled = false,
  orientation = "vertical",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  // A `<fieldset>` cannot take `fieldControlProps` wholesale — it is not a labelable control, so
  // that function's `id`/`name`/`aria-invalid` outputs are wrong here and invalid is routed through
  // `stateAttrs` instead. `aria-describedby` is the one half that is not structural, so it comes
  // from the same helper `fieldControlProps` uses rather than from a second, drifting expression.
  const describedBy = fieldDescribedBy(name, { ...(scope !== undefined ? { scope } : {}), description, invalid });
  return (
    <fieldset
      data-slot={slotToken("checkbox-group", inherited)}
      disabled={disabled}
      {...(describedBy !== undefined ? { "aria-describedby": describedBy } : {})}
      {...stateAttrs({ invalid, disabled, orientation })}
      class={cn("flex gap-2 border-0 m-0 p-0", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap", asClass(cls))}
      {...rest}>
      {children}
    </fieldset>
  );
};

const CheckboxGroupLabel: FC<PropsWithChildren<Omit<JSX.IntrinsicElements["legend"], "children">>> = ({
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <legend data-slot={slotToken("checkbox-group-label", inherited)} class={cn("mb-1 text-sm font-medium text-foreground", asClass(cls))} {...rest}>
    {children}
  </legend>
);

/** Submits with the form, resets with the form, and needs no JavaScript to do either. */
const CheckboxGroupItem: FC<PropsWithChildren<CheckboxGroupItemProps>> = ({
  name,
  value,
  scope,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <label data-slot='checkbox-group-item' class={cn("inline-flex items-center gap-2 text-sm text-foreground", asClass(cls))}>
    <input
      type='checkbox'
      data-slot={slotToken("checkbox-group-input", inherited)}
      id={itemId(name, value, scope)}
      name={name}
      value={value}
      class='size-4 rounded border-input accent-primary focus-visible:ring-2 focus-visible:ring-ring'
      {...rest}
    />
    {children}
  </label>
);

/**
 * A set of checkboxes sharing one name, wired to `core/field.tsx`'s existing description and error
 * plumbing rather than restating it.
 *
 * ```tsx
 * <CheckboxGroup name='toppings'>
 *   <CheckboxGroup.Label>Toppings</CheckboxGroup.Label>
 *   <CheckboxGroup.Item name='toppings' value='cheese'>Cheese</CheckboxGroup.Item>
 *   <CheckboxGroup.Item name='toppings' value='basil'>Basil</CheckboxGroup.Item>
 * </CheckboxGroup>
 * ```
 * @public
 */
export const CheckboxGroup = Object.assign(CheckboxGroupRoot, {
  Label: CheckboxGroupLabel,
  Item: CheckboxGroupItem,
  Description: FieldDescription,
  Error: FieldError,
});
