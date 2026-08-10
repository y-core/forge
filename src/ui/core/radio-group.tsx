/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { FieldDescription, FieldError, fieldDescribedBy, fieldId } from "./field";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type GroupOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface RadioGroupRootProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  /** Shared `name` — the thing that makes these radios one group, to the platform and to the form. */
  name: string;
  /** Distinguishes two same-named groups on one page. Ids are derived from `name` alone without it,
   * so both groups would emit the same id for every item as well as for the description and error.
   * Pass the same value to every `Item`, and to the group's `Description` and `Error`. */
  scope?: string;
  /** A description element renders for this group. Off by default: `aria-describedby` may only name
   * an element that is actually on the page, and a dangling IDREF is an error assistive technology
   * reports rather than ignores. `<RadioGroup.Description>` must be given the same `name` (and
   * `scope`) for the id it emits to match the one named here. */
  description?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  orientation?: GroupOrientation;
  children?: JSXNode;
}

interface RadioGroupItemProps extends Omit<JSX.IntrinsicElements["input"], "children" | "type"> {
  name: string;
  value: string;
  /** Must match the group's `scope` — see {@link RadioGroupRootProps.scope}. */
  scope?: string;
  children?: JSXNode;
}

/** This id is declared but never referenced — the input is wrapped in its `<label>`, so no `for`
 * names it, and a `value` containing whitespace is caller data that round-trips verbatim. Adding an
 * IDREF to it means gating it through `field.tsx`'s id-token predicate first. */
function itemId(name: string, value: string, scope?: string): string {
  return `${fieldId(name, scope)}-${value}`;
}

/**
 * A set of radios sharing one name.
 *
 * **`mountRovingFocus` is deliberately NOT used here, and this is the one place in forge's component
 * set where the shared composite controller is the wrong tool.** Measured in Chromium against three
 * same-named radios: the arrow keys already move focus *and* move the selection, already wrap at both
 * ends, and Tab already leaves the group after the first radio — the whole roving-tabindex contract,
 * supplied by the platform's own radio-group handling. (`tabindex` reads `0` on every radio while
 * that is true, so inspecting the attribute is misleading; the behaviour is what to check.)
 *
 * Mounting the composite controller on top would give the arrow keys two handlers: the controller
 * would move focus and the platform would move it again and check the result, skipping an item.
 * The correct amount of JavaScript for a radio group is none.
 *
 * `role="radiogroup"` is not emitted either, for the same reason the role came off `ToggleGroup`: a
 * `<fieldset>` with a `<legend>` around same-named radios is the native grouping, and the radios
 * carry their own `radio` semantics. Stating the role would add nothing an AT does not already know.
 */
const RadioGroupRoot: FC<PropsWithChildren<RadioGroupRootProps>> = ({
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
  // Same reasoning as `CheckboxGroup`: only the `aria-describedby` half of `fieldControlProps` is
  // adoptable by a `<fieldset>`, so it comes from the shared helper while invalid stays on
  // `stateAttrs` per the note above.
  const describedBy = fieldDescribedBy(name, { ...(scope !== undefined ? { scope } : {}), description, invalid });
  return (
    <fieldset
      data-slot={slotToken("radio-group", inherited)}
      disabled={disabled}
      {...(describedBy !== undefined ? { "aria-describedby": describedBy } : {})}
      {...stateAttrs({ invalid, disabled, orientation })}
      class={cn("flex gap-2 border-0 m-0 p-0", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap", asClass(cls))}
      {...rest}>
      {children}
    </fieldset>
  );
};

const RadioGroupLabel: FC<PropsWithChildren<Omit<JSX.IntrinsicElements["legend"], "children">>> = ({
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <legend data-slot={slotToken("radio-group-label", inherited)} class={cn("mb-1 text-sm font-medium text-foreground", asClass(cls))} {...rest}>
    {children}
  </legend>
);

const RadioGroupItem: FC<PropsWithChildren<RadioGroupItemProps>> = ({
  name,
  value,
  scope,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <label data-slot='radio-group-item' class={cn("inline-flex items-center gap-2 text-sm text-foreground", asClass(cls))}>
    <input
      type='radio'
      data-slot={slotToken("radio-group-input", inherited)}
      id={itemId(name, value, scope)}
      name={name}
      value={value}
      class='size-4 border-input accent-primary focus-visible:ring-2 focus-visible:ring-ring'
      {...rest}
    />
    {children}
  </label>
);

/**
 * Native radios with `core/field.tsx`'s description and error wiring around them.
 *
 * ```tsx
 * <RadioGroup name='plan'>
 *   <RadioGroup.Label>Plan</RadioGroup.Label>
 *   <RadioGroup.Item name='plan' value='free' checked>Free</RadioGroup.Item>
 *   <RadioGroup.Item name='plan' value='pro'>Pro</RadioGroup.Item>
 * </RadioGroup>
 * ```
 * @public
 */
export const RadioGroup = Object.assign(RadioGroupRoot, {
  Label: RadioGroupLabel,
  Item: RadioGroupItem,
  Description: FieldDescription,
  Error: FieldError,
});
