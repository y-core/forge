import type { Child, FC, JSX, PropsWithChildren } from "hono/jsx";
import { createContext, useContext } from "hono/jsx";
import { Separator } from "./separator";
import { cn } from "./utils/cn";
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

interface FieldGroupProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: Child;
}

interface FieldSetProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  children?: Child;
}

interface FieldLegendProps extends Omit<JSX.IntrinsicElements["legend"], "children"> {
  children?: Child;
  variant?: "label" | "legend";
}

interface FieldContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: Child;
}

interface FieldTitleProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: Child;
}

interface FieldSeparatorProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
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

  const describedBy = [
    props["aria-describedby"],
    field.descriptionId,
    field.invalid ? field.errorId : undefined,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  return {
    ...props,
    id: props.id ?? field.id,
    name: props.name ?? field.name,
    disabled: props.disabled ?? field.disabled,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid ? true : undefined),
  };
}

export const FieldSet: FC<PropsWithChildren<FieldSetProps>> = ({ class: cls, children, ...props }) => (
  <fieldset
    data-slot="field-set"
    class={cn("flex flex-col gap-6", typeof cls === "string" ? cls : undefined)}
    {...props}
  >
    {children}
  </fieldset>
);

export const FieldLegend: FC<PropsWithChildren<FieldLegendProps>> = ({
  class: cls,
  variant = "legend",
  children,
  ...props
}) => (
  <legend
    data-slot="field-legend"
    data-variant={variant}
    class={cn(
      "mb-3 font-medium",
      variant === "legend" ? "text-base text-brand-900" : "text-sm text-brand-900",
      typeof cls === "string" ? cls : undefined,
    )}
    {...props}
  >
    {children}
  </legend>
);

export const FieldGroup: FC<PropsWithChildren<FieldGroupProps>> = ({
  class: cls,
  children,
  ...props
}) => (
  <div
    data-slot="field-group"
    class={cn(
      "@container/field-group flex w-full flex-col gap-6",
      typeof cls === "string" ? cls : undefined,
    )}
    {...props}
  >
    {children}
  </div>
);

export const Field: FC<PropsWithChildren<FieldProps>> = ({
  name,
  invalid = false,
  disabled = false,
  orientation = "vertical",
  class: cls,
  children,
  ...props
}) => {
  const className = typeof cls === "string" ? cls : undefined;
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
        class={fieldVariants({ orientation, class: className })}
        {...props}
      >
        {children}
      </fieldset>
    </FieldContext.Provider>
  );
};

export const FieldContent: FC<PropsWithChildren<FieldContentProps>> = ({
  class: cls,
  children,
  ...props
}) => (
  <div
    data-slot="field-content"
    class={cn(
      "flex flex-1 flex-col gap-1.5 leading-snug",
      typeof cls === "string" ? cls : undefined,
    )}
    {...props}
  >
    {children}
  </div>
);

export const FieldLabel: FC<PropsWithChildren<LabelProps>> = ({
  class: cls,
  for: htmlFor,
  children,
  ...props
}) => {
  const field = getFieldContext();
  const className = typeof cls === "string" ? cls : undefined;

  return (
    <label
      data-slot="field-label"
      class={cn(
        "flex w-fit items-center gap-2 text-sm font-medium leading-snug text-brand-900 group-data-[disabled=true]/field:opacity-50",
        className,
      )}
      for={htmlFor ?? field?.id}
      {...props}
    >
      {children}
    </label>
  );
};

export const FieldTitle: FC<PropsWithChildren<FieldTitleProps>> = ({
  class: cls,
  children,
  ...props
}) => (
  <div
    data-slot="field-title"
    class={cn(
      "flex w-fit items-center gap-2 text-sm font-medium leading-snug text-brand-900 group-data-[disabled=true]/field:opacity-50",
      typeof cls === "string" ? cls : undefined,
    )}
    {...props}
  >
    {children}
  </div>
);

export const FieldDescription: FC<PropsWithChildren<DescriptionProps>> = ({
  class: cls,
  id,
  children,
  ...props
}) => {
  const field = getFieldContext();
  const className = typeof cls === "string" ? cls : undefined;

  return (
    <p
      data-slot="field-description"
      class={cn("text-sm leading-normal text-brand-600", className)}
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
  const className = typeof cls === "string" ? cls : undefined;

  return (
    <p
      data-slot="field-error"
      class={cn("text-sm font-normal text-red-600", className)}
      id={id ?? field?.errorId}
      role={role ?? "alert"}
      {...props}
    >
      {children}
    </p>
  );
};

export const FieldSeparator: FC<PropsWithChildren<FieldSeparatorProps>> = ({
  class: cls,
  children,
  ...props
}) => (
  <div
    data-content={children ? "true" : undefined}
    data-slot="field-separator"
    class={cn("relative h-5 text-sm", typeof cls === "string" ? cls : undefined)}
    {...props}
  >
    <Separator class="absolute inset-0 top-1/2" />
    {children ? (
      <span
        data-slot="field-separator-content"
        class="relative mx-auto block w-fit bg-white px-2 text-brand-600"
      >
        {children}
      </span>
    ) : null}
  </div>
);
