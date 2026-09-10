/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import type { Orientation } from "../contracts/types";
import type { Size } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { FIELD_ITEM_SIZE, FieldDescription, FieldError, fieldDescribedBy, fieldItemId, fieldStateProps } from "./field";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface RadioGroupRootProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  /** Shared `name` that makes these radios one group. */
  name: string;
  /** Distinguishes two same-named groups on one page; pass the same value to every `Item`, `Description` and `Error`. */
  scope?: string | undefined;
  /** A description element renders for this group. */
  description?: boolean | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  orientation?: Orientation | undefined;
  size?: Size | undefined;
  children?: JSXNode | undefined;
}

interface RadioGroupItemProps extends Omit<JSX.IntrinsicElements["input"], "children" | "size" | "type"> {
  name: string;
  value: string;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
  /** Must match the group's `scope` — see {@link RadioGroupRootProps.scope}. */
  scope?: string | undefined;
  children?: JSXNode | undefined;
}

const RadioGroupRoot: FC<PropsWithChildren<RadioGroupRootProps>> = ({
  name,
  scope,
  description = false,
  invalid = false,
  busy = false,
  disabled = false,
  orientation = "vertical",
  size = "md",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const describedBy = fieldDescribedBy(name, { ...(scope !== undefined ? { scope } : {}), description, invalid });
  // `aria-invalid` and `aria-busy` are not valid on `radiogroup`, so only the CSS state hooks land
  // here; an `Item` carries the aria on the input, where the role allows it.
  return (
    <fieldset
      data-slot={slotToken("radio-group", inherited)}
      role='radiogroup'
      disabled={disabled}
      aria-describedby={describedBy}
      {...presentationAttrs({ size })}
      {...stateAttrs({ disabled, orientation, invalid, busy })}
      class={cn("state-busy m-0 flex gap-2 border-0 state-invalid p-0", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap", cls)}
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
  <legend data-slot={slotToken("radio-group-label", inherited)} class={cn("mb-1 text-sm font-medium text-foreground", cls)} {...rest}>
    {children}
  </legend>
);

const RadioGroupItem: FC<PropsWithChildren<RadioGroupItemProps>> = ({
  name,
  value,
  scope,
  size = "md",
  invalid = false,
  busy = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const id = fieldItemId(name, value, scope);
  return (
    <label data-slot='radio-group-item' class={cn("inline-flex items-center gap-2 text-sm text-foreground", cls)}>
      <input
        type='radio' /* modern-css-allow: forge-ui-platform-accent-color — `appearance-none` redraws the box entirely, and accent-color only tints the native control's own shape, so it cannot express this design. */
        data-slot={slotToken("radio-group-input", inherited)}
        id={id}
        name={name}
        value={value}
        class={cn(
          "state-busy state-disabled shrink-0 appearance-none rounded-full border state-invalid border-input bg-background focus-ring-outset checked:bg-primary",
          FIELD_ITEM_SIZE[size],
        )}
        {...rest}
        {...fieldStateProps(invalid, busy)}
      />
      {children}
    </label>
  );
};

/** Native radios with `core/field.tsx`'s description and error wiring around them. @public */
export const RadioGroup = Object.assign(RadioGroupRoot, {
  Label: RadioGroupLabel,
  Item: RadioGroupItem,
  Description: FieldDescription,
  Error: FieldError,
});
