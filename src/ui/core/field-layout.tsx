/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { FIELD_LABEL_CLASSES, FieldDescription, FieldError, FieldLabel, FieldRoot } from "./field";
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

const FieldSet: FC<PropsWithChildren<FieldSetProps>> = ({ class: cls, children, ...props }) => (
  <fieldset data-slot='field-set' class={cn("flex flex-col gap-6", asClass(cls))} {...props}>
    {children}
  </fieldset>
);

const FieldLegend: FC<PropsWithChildren<FieldLegendProps>> = ({ class: cls, variant = "legend", children, ...props }) => (
  <legend
    data-slot='field-legend'
    data-variant={variant}
    class={cn("mb-3 font-medium", variant === "legend" ? "text-base text-foreground" : "text-sm text-foreground", asClass(cls))}
    {...props}>
    {children}
  </legend>
);

const FieldGroup: FC<PropsWithChildren<FieldGroupProps>> = ({ class: cls, children, ...props }) => (
  <div data-slot='field-group' class={cn("@container/field-group flex w-full flex-col gap-6", asClass(cls))} {...props}>
    {children}
  </div>
);

const FieldContent: FC<PropsWithChildren<FieldContentProps>> = ({ class: cls, children, ...props }) => (
  <div data-slot='field-content' class={cn("flex flex-1 flex-col gap-1.5 leading-snug", asClass(cls))} {...props}>
    {children}
  </div>
);

const FieldTitle: FC<PropsWithChildren<FieldTitleProps>> = ({ class: cls, children, ...props }) => (
  <div data-slot='field-title' class={cn(FIELD_LABEL_CLASSES, asClass(cls))} {...props}>
    {children}
  </div>
);

const FieldSeparator: FC<PropsWithChildren<FieldSeparatorProps>> = ({ class: cls, children, ...props }) => (
  <div data-content={children ? "true" : undefined} data-slot='field-separator' class={cn("relative h-5 text-sm", asClass(cls))} {...props}>
    <Separator class='absolute inset-0 top-1/2' />
    {children ? (
      <span data-slot='field-separator-content' class='relative mx-auto block w-fit bg-background px-2 text-muted-foreground'>
        {children}
      </span>
    ) : null}
  </div>
);

export const Field = Object.assign(FieldRoot, {
  Label: FieldLabel,
  Description: FieldDescription,
  Error: FieldError,
  Set: FieldSet,
  Legend: FieldLegend,
  Group: FieldGroup,
  Content: FieldContent,
  Title: FieldTitle,
  Separator: FieldSeparator,
});
