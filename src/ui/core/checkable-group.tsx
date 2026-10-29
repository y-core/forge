/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../render/jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import type { Orientation } from "../contracts/types";
import type { Size } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { blankMessage, FIELD_ITEM_SIZE, FieldDescription, FieldError, fieldDescribedBy, fieldItemId, fieldStateProps } from "./field";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { fillPartProps } from "./utils/part-props";

interface CheckableGroupRootProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  /** Shared `name` for every item in the group, and the key its ids are derived from. */
  name: string;
  /** Distinguishes two same-named groups on one page; pass the same value to every `Item`, `Description` and `Error`. */
  scope?: string | undefined;
  /** A description element renders for this group. */
  description?: boolean | undefined;
  /** The message the group's `Error` shows; a blank one marks nothing. */
  error?: JSXNode | undefined;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  orientation?: Orientation | undefined;
  size?: Size | undefined;
  children?: JSXNode | undefined;
}

interface CheckableGroupItemProps extends Omit<JSX.IntrinsicElements["input"], "children" | "size" | "type"> {
  name: string;
  value: string;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
  /** Must match the group's `scope` — see {@link CheckableGroupRootProps.scope}. */
  scope?: string | undefined;
  children?: JSXNode | undefined;
}

/** A native radio or checkbox group with the field description and error wiring around it. @internal */
export function createCheckableGroup(
  input: "checkbox" | "radio",
): FC<PropsWithChildren<CheckableGroupRootProps>> & {
  Label: FC<PropsWithChildren<Omit<JSX.IntrinsicElements["legend"], "children">>>;
  Item: FC<PropsWithChildren<CheckableGroupItemProps>>;
  Description: typeof FieldDescription;
  Error: typeof FieldError;
} {
  const Root: FC<PropsWithChildren<CheckableGroupRootProps>> = ({
    name,
    scope,
    description = false,
    error,
    busy = false,
    disabled = false,
    orientation = "vertical",
    size = "md",
    class: cls,
    children,
    "data-slot": inherited,
    "aria-describedby": existing,
    ...rest
  }) => {
    const invalid = !blankMessage(error);
    const describedBy = fieldDescribedBy(name, { ...(scope !== undefined ? { scope } : {}), description, invalid, existing });
    return (
      <fieldset
        data-slot={slotToken(`${input}-group`, inherited)}
        {...(input === "radio" ? { role: "radiogroup" } : {})}
        disabled={disabled}
        aria-describedby={describedBy}
        {...presentationAttrs({ size })}
        {...stateAttrs({ disabled, orientation, invalid, busy })}
        {...(invalid && input === "radio" ? { "aria-invalid": "true" } : {})}
        {...(busy ? { "aria-busy": "true" } : {})}
        class={cn("state-busy m-0 flex gap-x-2 border-0 state-invalid p-0", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap", cls)}
        {...rest}>
        {fillPartProps(children, new Map([[Item, { size }]]))}
      </fieldset>
    );
  };

  const Label: FC<PropsWithChildren<Omit<JSX.IntrinsicElements["legend"], "children">>> = ({
    class: cls,
    children,
    "data-slot": inherited,
    ...rest
  }) => (
    <legend data-slot={slotToken(`${input}-group-label`, inherited)} class={cn("mb-1 text-sm font-medium text-foreground", cls)} {...rest}>
      {children}
    </legend>
  );

  const Item: FC<PropsWithChildren<CheckableGroupItemProps>> = ({
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
      <label data-slot={`${input}-group-item`} class={cn("inline-flex min-h-control-sm items-center gap-2 text-sm text-foreground", cls)}>
        <input
          /* modern-css-allow: forge-ui-platform-accent-color — `appearance-none` redraws the box entirely, and accent-color only tints the native control's own shape, so it cannot express this design. */
          type={input}
          data-slot={slotToken(`${input}-group-input`, inherited)}
          id={id}
          name={name}
          value={value}
          class={cn(
            `state-busy state-disabled shrink-0 appearance-none ${input === "radio" ? "rounded-full" : "rounded-sm"} border-field state-invalid border-input bg-background focus-ring-outset checked:bg-primary`,
            FIELD_ITEM_SIZE[size],
          )}
          {...rest}
          {...fieldStateProps(invalid, busy)}
        />
        {children}
      </label>
    );
  };

  return Object.assign(Root, { Label, Item, Description: FieldDescription, Error: FieldError });
}
