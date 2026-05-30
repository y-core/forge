import type { FC, JSX, PropsWithChildren } from "hono/jsx";
import { FIELD_LABEL_CLASSES } from "./field";
import { Separator } from "./separator";
import { asClass, cn } from "./utils/cn";

interface FieldSetProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  children?: unknown;
}

interface FieldLegendProps extends Omit<JSX.IntrinsicElements["legend"], "children"> {
  children?: unknown;
  variant?: "label" | "legend";
}

interface FieldGroupProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: unknown;
}

interface FieldContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: unknown;
}

interface FieldTitleProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: unknown;
}

interface FieldSeparatorProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: unknown;
}

export const FieldSet: FC<PropsWithChildren<FieldSetProps>> = ({ class: cls, children, ...props }) => (
  <fieldset
    data-slot="field-set"
    class={cn("flex flex-col gap-6", asClass(cls))}
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
      asClass(cls),
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
    class={cn("@container/field-group flex w-full flex-col gap-6", asClass(cls))}
    {...props}
  >
    {children}
  </div>
);

export const FieldContent: FC<PropsWithChildren<FieldContentProps>> = ({
  class: cls,
  children,
  ...props
}) => (
  <div
    data-slot="field-content"
    class={cn("flex flex-1 flex-col gap-1.5 leading-snug", asClass(cls))}
    {...props}
  >
    {children}
  </div>
);

export const FieldTitle: FC<PropsWithChildren<FieldTitleProps>> = ({
  class: cls,
  children,
  ...props
}) => (
  <div
    data-slot="field-title"
    class={cn(FIELD_LABEL_CLASSES, asClass(cls))}
    {...props}
  >
    {children}
  </div>
);

export const FieldSeparator: FC<PropsWithChildren<FieldSeparatorProps>> = ({
  class: cls,
  children,
  ...props
}) => (
  <div
    data-content={children ? "true" : undefined}
    data-slot="field-separator"
    class={cn("relative h-5 text-sm", asClass(cls))}
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
