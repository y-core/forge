/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { NUMBER_FIELD_SCOPE } from "../contracts/number-field-contract";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface NumberFieldRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

type NumberFieldInputProps = Omit<JSX.IntrinsicElements["input"], "children" | "type">;

interface NumberFieldButtonProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** Accessible name for the stepper. Defaults to `"Decrement"` / `"Increment"`. */
  label?: string;
  children?: JSXNode;
}

const BUTTON_BASE =
  "inline-flex size-8 items-center justify-center rounded-md border border-input bg-background " +
  "text-foreground cursor-pointer outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-50";

const NumberFieldRoot: FC<NumberFieldRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("number-field", inherited)}
    data-scope={NUMBER_FIELD_SCOPE}
    class={cn("inline-flex items-center gap-1", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

const NumberFieldInput: FC<NumberFieldInputProps> = ({ class: cls, "data-slot": inherited, ...rest }) => (
  <input
    type='number'
    data-slot={slotToken("number-field-input", inherited)}
    class={cn(
      "w-20 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums text-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      asClass(cls),
    )}
    {...rest}
  />
);

const NumberFieldDecrement: FC<NumberFieldButtonProps> = ({ label = "Decrement", class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    data-slot={slotToken("number-field-decrement", inherited)}
    aria-label={label}
    class={cn(BUTTON_BASE, asClass(cls))}
    {...rest}>
    {children ?? "−"}
  </button>
);

const NumberFieldIncrement: FC<NumberFieldButtonProps> = ({ label = "Increment", class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    data-slot={slotToken("number-field-increment", inherited)}
    aria-label={label}
    class={cn(BUTTON_BASE, asClass(cls))}
    {...rest}>
    {children ?? "+"}
  </button>
);

/** A numeric input with optional styled stepper buttons. @public */
export const NumberField = Object.assign(NumberFieldRoot, {
  Input: NumberFieldInput,
  Decrement: NumberFieldDecrement,
  Increment: NumberFieldIncrement,
});
