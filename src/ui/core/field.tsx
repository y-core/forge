import type { Child, FC, JSX, PropsWithChildren } from "hono/jsx";
import { createContext, useContext } from "hono/jsx";
import { asClass, cn } from "./utils/cn";
import { cva } from "./utils/cva";

interface FieldContextValue {
  name: string;
  id: string;
  descriptionId: string;
  errorId: string;
  invalid: boolean;
  disabled: boolean;
}

type FieldOrientation = "horizontal" | "responsive" | "vertical";

interface FieldProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  name: string;
  invalid?: boolean;
  disabled?: boolean;
  orientation?: FieldOrientation;
  children?: Child;
}

type LabelProps = JSX.IntrinsicElements["label"];
type DescriptionProps = JSX.IntrinsicElements["p"];
type ErrorProps = JSX.IntrinsicElements["p"];

interface FieldControlProps {
  id?: string;
  name?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

const FieldContext = createContext<FieldContextValue | null>(null);

const fieldVariants = cva({
  base: "group/field flex w-full gap-3 data-[invalid=true]:text-red-600",
  variants: {
    orientation: {
      horizontal:
        "flex-row items-start [&>[data-slot=field-label]]:flex-auto [&>[data-slot=field-content]]:flex-1",
      responsive:
        "flex-col [&>*]:w-full @md/field-group:flex-row @md/field-group:items-start @md/field-group:[&>*]:w-auto @md/field-group:[&>[data-slot=field-label]]:flex-auto @md/field-group:[&>[data-slot=field-content]]:flex-1",
      vertical: "flex-col [&>*]:w-full",
    },
  },
  defaultVariants: {
    orientation: "vertical",
  },
});

/** Shared Tailwind class string for FieldLabel and FieldTitle. */
export const FIELD_LABEL_CLASSES =
  "flex w-fit items-center gap-2 text-sm font-medium leading-snug text-brand-900 group-data-[disabled=true]/field:opacity-50";

export function fieldId(name: string): string {
  return `field-${name}`;
}

export function fieldDescriptionId(name: string): string {
  return `field-${name}-description`;
}

export function fieldErrorId(name: string): string {
  return `field-${name}-error`;
}

function getFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export function useFieldControlProps<T extends FieldControlProps>(props: T): T {
  const field = getFieldContext();
  if (!field) {
    return props;
  }

  const existingDescribedBy = props["aria-describedby"];
  const describedBy = existingDescribedBy
    ? field.invalid
      ? `${existingDescribedBy} ${field.descriptionId} ${field.errorId}`
      : `${existingDescribedBy} ${field.descriptionId}`
    : field.invalid
      ? `${field.descriptionId} ${field.errorId}`
      : field.descriptionId;

  return {
    ...props,
    id: props.id ?? field.id,
    name: props.name ?? field.name,
    disabled: props.disabled ?? field.disabled,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid ? true : undefined),
  };
}

export const Field: FC<PropsWithChildren<FieldProps>> = ({
  name,
  invalid = false,
  disabled = false,
  orientation = "vertical",
  class: cls,
  children,
  ...props
}) => {
  const value: FieldContextValue = {
    descriptionId: fieldDescriptionId(name),
    disabled,
    errorId: fieldErrorId(name),
    id: fieldId(name),
    invalid,
    name,
  };

  return (
    <FieldContext.Provider value={value}>
      <fieldset
        disabled={disabled}
        data-slot="field"
        data-disabled={disabled ? "true" : undefined}
        data-invalid={invalid ? "true" : undefined}
        data-orientation={orientation}
        class={fieldVariants({ orientation, class: asClass(cls) })}
        {...props}
      >
        {children}
      </fieldset>
    </FieldContext.Provider>
  );
};

export const FieldLabel: FC<PropsWithChildren<LabelProps>> = ({
  class: cls,
  for: htmlFor,
  children,
  ...props
}) => {
  const field = getFieldContext();

  return (
    <label
      data-slot="field-label"
      class={cn(FIELD_LABEL_CLASSES, asClass(cls))}
      for={htmlFor ?? field?.id}
      {...props}
    >
      {children}
    </label>
  );
};

export const FieldDescription: FC<PropsWithChildren<DescriptionProps>> = ({
  class: cls,
  id,
  children,
  ...props
}) => {
  const field = getFieldContext();

  return (
    <p
      data-slot="field-description"
      class={cn("text-sm leading-normal text-brand-600", asClass(cls))}
      id={id ?? field?.descriptionId}
      {...props}
    >
      {children}
    </p>
  );
};

export const FieldError: FC<PropsWithChildren<ErrorProps>> = ({
  class: cls,
  id,
  role,
  children,
  ...props
}) => {
  if (children == null || children === false) {
    return null;
  }

  const field = getFieldContext();

  return (
    <p
      data-slot="field-error"
      class={cn("text-sm font-normal text-red-600", asClass(cls))}
      id={id ?? field?.errorId}
      role={role ?? "alert"}
      {...props}
    >
      {children}
    </p>
  );
};
