/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { FIELD_LABEL_CLASSES, FieldDescription, FieldError, FieldLabel, FieldRoot } from "./field";
import { Separator } from "./separator";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface FieldSetProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  children?: unknown | undefined;
}

interface FieldLegendProps extends Omit<JSX.IntrinsicElements["legend"], "children"> {
  children?: unknown | undefined;
  /** Which of the two type scales the legend wears. Not the ratified `appearance` emphasis axis. */
  as?: "label" | "legend" | undefined;
}

interface FieldGroupProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: unknown | undefined;
}

interface FieldContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: unknown | undefined;
}

interface FieldTitleProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: unknown | undefined;
}

interface FieldSeparatorProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: unknown | undefined;
}

const FieldSet: FC<PropsWithChildren<FieldSetProps>> = ({ class: cls, children, "data-slot": inherited, ...props }) => (
  <fieldset data-slot={slotToken("field-set", inherited)} class={cn("flex flex-col gap-6", cls)} {...props}>
    {children}
  </fieldset>
);

const FieldLegend: FC<PropsWithChildren<FieldLegendProps>> = ({ class: cls, as: kind = "legend", children, "data-slot": inherited, ...props }) => (
  <legend
    data-slot={slotToken("field-legend", inherited)}
    data-as={kind}
    class={cn("mb-3 font-medium", kind === "legend" ? "text-base text-foreground" : "text-sm text-foreground", cls)}
    {...props}>
    {children}
  </legend>
);

const FieldGroup: FC<PropsWithChildren<FieldGroupProps>> = ({ class: cls, children, "data-slot": inherited, ...props }) => (
  <div data-slot={slotToken("field-group", inherited)} class={cn("@container/field-group flex w-full flex-col gap-6", cls)} {...props}>
    {children}
  </div>
);

const FieldContent: FC<PropsWithChildren<FieldContentProps>> = ({ class: cls, children, "data-slot": inherited, ...props }) => (
  <div data-slot={slotToken("field-content", inherited)} class={cn("flex flex-1 flex-col gap-1.5 leading-snug", cls)} {...props}>
    {children}
  </div>
);

const FieldTitle: FC<PropsWithChildren<FieldTitleProps>> = ({ class: cls, children, "data-slot": inherited, ...props }) => (
  <div data-slot={slotToken("field-title", inherited)} class={cn(FIELD_LABEL_CLASSES, cls)} {...props}>
    {children}
  </div>
);

const FieldSeparator: FC<PropsWithChildren<FieldSeparatorProps>> = ({ class: cls, children, "data-slot": inherited, ...props }) => (
  <div
    data-content={children ? "true" : undefined}
    data-slot={slotToken("field-separator", inherited)}
    class={cn("relative h-5 text-sm", cls)}
    {...props}>
    <Separator class='absolute inset-0 top-1/2' />
    {children ? (
      <span data-slot='field-separator-content' class='relative mx-auto block w-fit bg-background px-2 text-muted-foreground'>
        {children}
      </span>
    ) : null}
  </div>
);

/** Compound form-field layout composing the field root with its label, description, error, and grouping subcomponents. @public */
export const FormField = Object.assign(FieldRoot, {
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
