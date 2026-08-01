/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { FieldDescription, FieldError, fieldDescriptionId, fieldErrorId, fieldId } from "./field";
import { asClass, cn } from "./utils/cn";

type GroupOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface CheckboxGroupRootProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  /** Shared `name` for every checkbox in the group — also the key its ids are derived from. */
  name: string;
  invalid?: boolean;
  disabled?: boolean;
  orientation?: GroupOrientation;
  children?: JSXNode;
}

interface CheckboxGroupItemProps extends Omit<JSX.IntrinsicElements["input"], "children" | "type"> {
  name: string;
  value: string;
  children?: JSXNode;
}

/** Per-item id, derived rather than passed: the group and the item cannot see each other, and a
 * hand-written id in two places is the drift `field.tsx`'s helpers already exist to prevent. */
function itemId(name: string, value: string): string {
  return `${fieldId(name)}-${value}`;
}

const CheckboxGroupRoot: FC<PropsWithChildren<CheckboxGroupRootProps>> = ({
  name,
  invalid = false,
  disabled = false,
  orientation = "vertical",
  class: cls,
  children,
  ...rest
}) => (
  <fieldset
    data-slot='checkbox-group'
    disabled={disabled}
    aria-describedby={invalid ? `${fieldDescriptionId(name)} ${fieldErrorId(name)}` : fieldDescriptionId(name)}
    {...stateAttrs({ invalid, disabled, orientation })}
    class={cn("flex gap-2 border-0 m-0 p-0", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap", asClass(cls))}
    {...rest}>
    {children}
  </fieldset>
);

const CheckboxGroupLabel: FC<PropsWithChildren<Omit<JSX.IntrinsicElements["legend"], "children">>> = ({ class: cls, children, ...rest }) => (
  <legend data-slot='checkbox-group-label' class={cn("mb-1 text-sm font-medium text-foreground", asClass(cls))} {...rest}>
    {children}
  </legend>
);

/** A real `<input type="checkbox">` inside a real `<label>`: it submits with the form, resets with
 * the form, and needs no JavaScript to do either. */
const CheckboxGroupItem: FC<PropsWithChildren<CheckboxGroupItemProps>> = ({ name, value, class: cls, children, ...rest }) => (
  <label data-slot='checkbox-group-item' class={cn("inline-flex items-center gap-2 text-sm text-foreground", asClass(cls))}>
    <input
      type='checkbox'
      data-slot='checkbox-group-input'
      id={itemId(name, value)}
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
