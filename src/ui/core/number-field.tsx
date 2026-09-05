/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { NUMBER_FIELD_SCOPE } from "../contracts/number-field-contract";
import { presentationAttrs } from "../contracts/vocabulary";
import type { Size } from "../contracts/vocabulary";
import { fieldStateProps } from "./field";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { FIELD_SIZE } from "./utils/recipes";

interface NumberFieldRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode | undefined;
}

type NumberFieldInputProps = Omit<JSX.IntrinsicElements["input"], "children" | "size" | "type"> & {
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
};

interface NumberFieldButtonProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** Accessible name for the stepper. Defaults to `"Decrement"` / `"Increment"`. */
  label?: string | undefined;
  children?: JSXNode | undefined;
}

const BUTTON_BASE = cn(
  "inline-flex size-8 items-center justify-center rounded-field border border-input bg-background " +
    "cursor-pointer text-foreground focus-ring hover:bg-accent " +
    "state-disabled",
);

const NumberFieldRoot: FC<NumberFieldRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("number-field", inherited)} data-scope={NUMBER_FIELD_SCOPE} class={cn("inline-flex items-center gap-1", cls)} {...rest}>
    {children}
  </div>
);

const NumberFieldInput: FC<NumberFieldInputProps> = ({
  class: cls,
  size = "md",
  invalid = false,
  busy = false,
  "data-slot": inherited,
  ...rest
}) => (
  <input
    type='number'
    data-slot={slotToken("number-field-input", inherited)}
    {...presentationAttrs({ size })}
    class={cn("state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring", "state-invalid", FIELD_SIZE[size], cls)}
    {...rest}
    {...fieldStateProps(invalid, busy)}
  />
);

const NumberFieldDecrement: FC<NumberFieldButtonProps> = ({ label = "Decrement", class: cls, children, "data-slot": inherited, ...rest }) => (
  <button type='button' data-slot={slotToken("number-field-decrement", inherited)} aria-label={label} class={cn(BUTTON_BASE, cls)} {...rest}>
    {children ?? "−"}
  </button>
);

const NumberFieldIncrement: FC<NumberFieldButtonProps> = ({ label = "Increment", class: cls, children, "data-slot": inherited, ...rest }) => (
  <button type='button' data-slot={slotToken("number-field-increment", inherited)} aria-label={label} class={cn(BUTTON_BASE, cls)} {...rest}>
    {children ?? "+"}
  </button>
);

/** A numeric input with optional styled stepper buttons. @public */
export const NumberField = Object.assign(NumberFieldRoot, {
  Input: NumberFieldInput,
  Decrement: NumberFieldDecrement,
  Increment: NumberFieldIncrement,
});
