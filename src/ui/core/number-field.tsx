/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { NUMBER_FIELD_SCOPE } from "../contracts/number-field-contract";
import { asClass, cn } from "./utils/cn";

interface NumberFieldRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

type NumberFieldInputProps = Omit<JSX.IntrinsicElements["input"], "children" | "type">;

interface NumberFieldButtonProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  children?: JSXNode;
}

const BUTTON_BASE =
  "inline-flex size-8 items-center justify-center rounded-md border border-input bg-background " +
  "text-foreground cursor-pointer outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-50";

const NumberFieldRoot: FC<NumberFieldRootProps> = ({ class: cls, children, ...rest }) => (
  <div data-slot='number-field' data-scope={NUMBER_FIELD_SCOPE} class={cn("inline-flex items-center gap-1", asClass(cls))} {...rest}>
    {children}
  </div>
);

/** `type="number"` and nothing else: the input is the value, the validation and the form entry. */
const NumberFieldInput: FC<NumberFieldInputProps> = ({ class: cls, ...rest }) => (
  <input
    type='number'
    data-slot='number-field-input'
    class={cn(
      "w-20 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums text-foreground",
      "focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      asClass(cls),
    )}
    {...rest}
  />
);

const NumberFieldDecrement: FC<NumberFieldButtonProps> = ({ class: cls, children, ...rest }) => (
  <button type='button' data-slot='number-field-decrement' aria-label='Decrement' class={cn(BUTTON_BASE, asClass(cls))} {...rest}>
    {children ?? "−"}
  </button>
);

const NumberFieldIncrement: FC<NumberFieldButtonProps> = ({ class: cls, children, ...rest }) => (
  <button type='button' data-slot='number-field-increment' aria-label='Increment' class={cn(BUTTON_BASE, asClass(cls))} {...rest}>
    {children ?? "+"}
  </button>
);

/**
 * A numeric input with optional styled stepper buttons.
 *
 * The buttons exist for **styling control, not behaviour**: `<input type="number">` already has a
 * spinner and already steps with the arrow keys, so this component is what you reach for when the
 * UA's spinner cannot be made to match the rest of the interface. Drop the buttons and everything
 * still works.
 *
 * The input stays authoritative throughout — the controller steps it with the element's own
 * `stepUp()` / `stepDown()` and dispatches a real `input` event, so `bindField` and any other
 * listener see an ordinary edit with no special case.
 *
 * ```tsx
 * <NumberField>
 *   <NumberField.Decrement />
 *   <NumberField.Input name='count' value='1' min='0' max='10' />
 *   <NumberField.Increment />
 * </NumberField>
 * ```
 * @public
 */
export const NumberField = Object.assign(NumberFieldRoot, {
  Input: NumberFieldInput,
  Decrement: NumberFieldDecrement,
  Increment: NumberFieldIncrement,
});
