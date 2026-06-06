import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { asClass, cn } from "./utils/cn";
import { cva } from "./utils/cva";

/** Plain object describing a form field — pass explicitly to controls instead of relying on context. @public */
export interface FieldDescriptor {
  name: string;
  invalid?: boolean;
  disabled?: boolean;
}

type FieldOrientation = "horizontal" | "responsive" | "vertical";

interface FieldProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  name: string;
  invalid?: boolean;
  disabled?: boolean;
  orientation?: FieldOrientation;
  children?: JSXNode;
}

type LabelProps = JSX.IntrinsicElements["label"];
type DescriptionProps = JSX.IntrinsicElements["p"];
type ErrorProps = JSX.IntrinsicElements["p"];

interface FieldControlProps {
  id?: string;
  name?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
}

const fieldVariants = cva({
  base: "group/field flex w-full gap-3 data-[invalid=true]:text-red-600",
  variants: {
    orientation: {
      horizontal: "flex-row items-start [&>[data-slot=field-label]]:flex-auto [&>[data-slot=field-content]]:flex-1",
      responsive:
        "flex-col [&>*]:w-full @md/field-group:flex-row @md/field-group:items-start @md/field-group:[&>*]:w-auto @md/field-group:[&>[data-slot=field-label]]:flex-auto @md/field-group:[&>[data-slot=field-content]]:flex-1",
      vertical: "flex-col [&>*]:w-full",
    },
  },
  defaultVariants: { orientation: "vertical" },
});

/** Shared Tailwind class string for FieldLabel and FieldTitle. */
export const FIELD_LABEL_CLASSES =
  "flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50";

export function fieldId(name: string): string {
  return `field-${name}`;
}

export function fieldDescriptionId(name: string): string {
  return `field-${name}-description`;
}

export function fieldErrorId(name: string): string {
  return `field-${name}-error`;
}

/** Pure function that merges field descriptor wiring into control props. @public */
export function fieldControlProps<T extends FieldControlProps>(props: T, field: FieldDescriptor): T {
  const invalid = field.invalid ?? false;
  const descriptionId = fieldDescriptionId(field.name);
  const errorId = fieldErrorId(field.name);

  const existingDescribedBy = props["aria-describedby"];
  const describedBy = existingDescribedBy
    ? invalid
      ? `${existingDescribedBy} ${descriptionId} ${errorId}`
      : `${existingDescribedBy} ${descriptionId}`
    : invalid
      ? `${descriptionId} ${errorId}`
      : descriptionId;

  return {
    ...props,
    id: props.id ?? fieldId(field.name),
    name: props.name ?? field.name,
    disabled: props.disabled ?? field.disabled,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (invalid ? true : undefined),
  };
}

export const FieldRoot: FC<PropsWithChildren<FieldProps>> = ({
  name,
  invalid = false,
  disabled = false,
  orientation = "vertical",
  class: cls,
  children,
  ...props
}) => {
  // cva's `class` is `class?: string` (no `undefined`), so omit it rather than pass undefined.
  const clsValue = asClass(cls);
  return (
    <fieldset
      disabled={disabled}
      data-slot='field'
      data-disabled={disabled ? "true" : undefined}
      data-invalid={invalid ? "true" : undefined}
      data-orientation={orientation}
      class={fieldVariants({ orientation, ...(clsValue !== undefined ? { class: clsValue } : {}) })}
      {...props}>
      {children}
    </fieldset>
  );
};

export const FieldLabel: FC<PropsWithChildren<LabelProps & { name?: string }>> = ({ class: cls, for: htmlFor, name, children, ...props }) => (
  <label data-slot='field-label' class={cn(FIELD_LABEL_CLASSES, asClass(cls))} for={htmlFor ?? (name ? fieldId(name) : undefined)} {...props}>
    {children}
  </label>
);

export const FieldDescription: FC<PropsWithChildren<DescriptionProps & { name?: string }>> = ({ class: cls, id, name, children, ...props }) => {
  const resolvedId = id ?? (name ? fieldDescriptionId(name) : undefined);
  return (
    <p
      data-slot='field-description'
      class={cn("text-sm leading-normal text-muted-foreground", asClass(cls))}
      {...(resolvedId !== undefined ? { id: resolvedId } : {})}
      {...props}>
      {children}
    </p>
  );
};

export const FieldError: FC<PropsWithChildren<ErrorProps & { name?: string }>> = ({ class: cls, id, role, name, children, ...props }) => {
  if (children == null || children === false) {
    return null;
  }

  const resolvedId = id ?? (name ? fieldErrorId(name) : undefined);
  return (
    <p
      data-slot='field-error'
      class={cn("text-sm font-normal text-red-600", asClass(cls))}
      {...(resolvedId !== undefined ? { id: resolvedId } : {})}
      role={role ?? "alert"}
      {...props}>
      {children}
    </p>
  );
};
