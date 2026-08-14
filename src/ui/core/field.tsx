/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";
import { cva } from "./utils/cva";

/** Plain object describing a form field — pass explicitly to controls instead of relying on context. @public */
export interface FieldDescriptor {
  name: string;
  /** Distinguishes fields that share a `name` on one page. */
  scope?: string;
  /** A description element renders for this field. */
  description?: boolean;
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

interface FieldNaming {
  name?: string;
  scope?: string;
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
  base: "group/field flex w-full gap-3 data-[invalid]:text-destructive",
  variants: {
    orientation: {
      horizontal: "flex-row items-start [&>[data-slot~=field-label]]:flex-auto [&>[data-slot~=field-content]]:flex-1",
      responsive:
        "flex-col [&>*]:w-full @md/field-group:flex-row @md/field-group:items-start @md/field-group:[&>*]:w-auto @md/field-group:[&>[data-slot~=field-label]]:flex-auto @md/field-group:[&>[data-slot~=field-content]]:flex-1",
      vertical: "flex-col [&>*]:w-full",
    },
  },
  defaultVariants: { orientation: "vertical" },
});

/** Shared Tailwind class string for FieldLabel and FieldTitle. */
export const FIELD_LABEL_CLASSES =
  "flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50";

// HTML's ASCII whitespace set, deliberately not JS `\s`: U+00A0 and the Unicode spaces are legal id
// characters that no parser treats as a token separator.
const ASCII_WS = /[\t\n\f\r ]/;

const ASCII_WS_ONLY = /^[\t\n\f\r ]*$/;

function idToken(value: string): boolean {
  return value !== "" && !ASCII_WS.test(value);
}

/** Whether an id can be derived from this naming — every part must be a single id token. @internal */
export function derivable(name: string | undefined, scope?: string): name is string {
  return name !== undefined && idToken(name) && (scope === undefined || ASCII_WS_ONLY.test(scope) || idToken(scope));
}

/** The control's id, optionally separated from a same-named field by `scope`. */
export function fieldId(name: string, scope?: string): string {
  return scope !== undefined && !ASCII_WS_ONLY.test(scope) ? `field-${scope}-${name}` : `field-${name}`;
}

/** The id of the field's description, derived from {@link fieldId} so the two always agree. */
export function fieldDescriptionId(name: string, scope?: string): string {
  return `${fieldId(name, scope)}-description`;
}

/** The id of the field's error message, derived from {@link fieldId} so the two always agree. */
export function fieldErrorId(name: string, scope?: string): string {
  return `${fieldId(name, scope)}-error`;
}

/** What {@link fieldDescribedBy} needs beyond the field's name. */
export interface FieldDescribedByOptions {
  scope?: string;
  /** A description element renders for this field. */
  description?: boolean;
  invalid?: boolean;
  /** An `aria-describedby` the caller already has, kept ahead of the derived ids. */
  existing?: string;
}

/** The `aria-describedby` value for a field, or `undefined` when nothing to point at renders. @public */
export function fieldDescribedBy(name: string, options: FieldDescribedByOptions = {}): string | undefined {
  const named = derivable(name, options.scope);
  const value = [
    options.existing,
    named && options.description ? fieldDescriptionId(name, options.scope) : undefined,
    named && options.invalid ? fieldErrorId(name, options.scope) : undefined,
  ]
    .flatMap((part) => (part === undefined ? [] : part.split(/[\t\n\f\r ]+/)))
    .filter((token) => token !== "")
    .join(" ");
  return value ? value : undefined;
}

/** Merges field descriptor wiring into control props. @public */
export function fieldControlProps<T extends FieldControlProps>(props: T, field: FieldDescriptor): T {
  const invalid = field.invalid ?? false;
  const describedBy = fieldDescribedBy(field.name, {
    ...(field.scope !== undefined ? { scope: field.scope } : {}),
    ...(field.description !== undefined ? { description: field.description } : {}),
    invalid,
    ...(props["aria-describedby"] !== undefined ? { existing: props["aria-describedby"] } : {}),
  });

  const id = props.id ?? (derivable(field.name, field.scope) ? fieldId(field.name, field.scope) : undefined);

  return {
    ...props,
    ...(id !== undefined ? { id } : {}),
    name: props.name ?? field.name,
    disabled: props.disabled ?? field.disabled,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    "aria-invalid": props["aria-invalid"] ?? (invalid ? true : undefined),
  };
}

/** A `<fieldset>` wrapper carrying a field's name, orientation, and invalid or disabled state to its parts. @internal */
export const FieldRoot: FC<PropsWithChildren<FieldProps>> = ({
  name,
  invalid = false,
  disabled = false,
  orientation = "vertical",
  class: cls,
  children,
  "data-slot": inherited,
  ...props
}) => {
  const clsValue = asClass(cls);
  return (
    <fieldset
      disabled={disabled}
      data-slot={slotToken("field", inherited)}
      {...stateAttrs({ disabled, invalid, orientation })}
      class={fieldVariants({ orientation, ...(clsValue !== undefined ? { class: clsValue } : {}) })}
      {...props}>
      {children}
    </fieldset>
  );
};

/** A `<label>` whose `for` is derived from the field's name and scope unless given explicitly. @internal */
export const FieldLabel: FC<PropsWithChildren<LabelProps & FieldNaming>> = ({
  class: cls,
  for: htmlFor,
  name,
  scope,
  children,
  "data-slot": inherited,
  ...props
}) => (
  <label
    data-slot={slotToken("field-label", inherited)}
    class={cn(FIELD_LABEL_CLASSES, asClass(cls))}
    for={htmlFor ?? (derivable(name, scope) ? fieldId(name, scope) : undefined)}
    {...props}>
    {children}
  </label>
);

/** Help text for a field, with the id that `aria-describedby` points at derived from its name and scope. @internal */
export const FieldDescription: FC<PropsWithChildren<DescriptionProps & FieldNaming>> = ({
  class: cls,
  id,
  name,
  scope,
  children,
  "data-slot": inherited,
  ...props
}) => {
  const resolvedId = id ?? (derivable(name, scope) ? fieldDescriptionId(name, scope) : undefined);
  return (
    <p
      data-slot={slotToken("field-description", inherited)}
      class={cn("text-sm leading-normal text-muted-foreground", asClass(cls))}
      {...(resolvedId !== undefined ? { id: resolvedId } : {})}
      {...props}>
      {children}
    </p>
  );
};

/** A field's error message as a live `alert`, rendering nothing when it has no children. @internal */
export const FieldError: FC<PropsWithChildren<ErrorProps & FieldNaming>> = ({
  class: cls,
  id,
  role,
  name,
  scope,
  children,
  "data-slot": inherited,
  ...props
}) => {
  if (children == null || children === false) {
    return null;
  }

  const resolvedId = id ?? (derivable(name, scope) ? fieldErrorId(name, scope) : undefined);
  return (
    <p
      data-slot={slotToken("field-error", inherited)}
      class={cn("text-sm font-normal text-destructive", asClass(cls))}
      {...(resolvedId !== undefined ? { id: resolvedId } : {})}
      role={role ?? "alert"}
      {...props}>
      {children}
    </p>
  );
};
