/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { derivable, FieldDescription, FieldError, fieldDescribedBy, fieldId } from "./field";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type GroupOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface RadioGroupRootProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  /** Shared `name` that makes these radios one group. */
  name: string;
  /** Distinguishes two same-named groups on one page; pass the same value to every `Item`, `Description` and `Error`. */
  scope?: string;
  /** A description element renders for this group. */
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

function itemId(name: string, value: string, scope?: string): string | undefined {
  return derivable(name, scope) && derivable(value) ? `${fieldId(name, scope)}-${value}` : undefined;
}

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
}) => {
  const id = itemId(name, value, scope);
  return (
    <label data-slot='radio-group-item' class={cn("inline-flex items-center gap-2 text-sm text-foreground", asClass(cls))}>
      <input
        type='radio' /* modern-css-allow: forge-ui-platform-accent-color — `appearance-none` redraws the box entirely, and accent-color only tints the native control's own shape, so it cannot express this design. */
        data-slot={slotToken("radio-group-input", inherited)}
        {...(id !== undefined ? { id } : {})}
        name={name}
        value={value}
        class='size-4 shrink-0 appearance-none rounded-full border border-input bg-background checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
        {...rest}
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
