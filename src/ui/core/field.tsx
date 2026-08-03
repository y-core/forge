/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { asClass, cn } from "./utils/cn";
import { cva } from "./utils/cva";

/** Plain object describing a form field — pass explicitly to controls instead of relying on context. @public */
export interface FieldDescriptor {
  name: string;
  /** Distinguishes fields that share a `name` on one page — a sign-in and a sign-up form both
   * holding an `email`. Ids are derived from `name` alone without it, so the two forms would produce
   * one id twice and a label would point at whichever control the browser found first. Pass the same
   * value to the field's `Label`, `Description` and `Error`. */
  scope?: string;
  /** A description element renders for this field. Off by default: `aria-describedby` may only name
   * an element that is actually on the page, and a dangling IDREF is an error assistive technology
   * reports rather than ignores. */
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

/** What a compound member needs to derive the same id the control derived: the field's name, and the
 * scope that separates it from a same-named field elsewhere on the page. */
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
  base: "group/field flex w-full gap-3 data-[invalid]:text-red-600",
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
  "flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50";

/** The control's id. `scope` separates two fields that share a name on one page. */
export function fieldId(name: string, scope?: string): string {
  return scope ? `field-${scope}-${name}` : `field-${name}`;
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
  /** A description element renders for this field — see {@link FieldDescriptor.description}. */
  description?: boolean;
  invalid?: boolean;
  /** An `aria-describedby` the caller already has, kept ahead of the derived ids. */
  existing?: string;
}

/**
 * The `aria-describedby` value for a field, or `undefined` when nothing to point at renders. @public
 *
 * Names only the elements that actually render — the description when the field declares one, the
 * error when the field is invalid — because an IDREF pointing at nothing is not ignored by
 * assistive technology, it is reported as an error.
 *
 * Extracted from {@link fieldControlProps} because it is the one piece of that function's output a
 * `<fieldset>`-based group can adopt. The rest of it — `id`, `name`, `aria-invalid` — is shaped for
 * a labelable control and is wrong on a fieldset, which is why the groups call this directly
 * instead.
 */
export function fieldDescribedBy(name: string, options: FieldDescribedByOptions = {}): string | undefined {
  const value = [
    options.existing,
    options.description ? fieldDescriptionId(name, options.scope) : undefined,
    options.invalid ? fieldErrorId(name, options.scope) : undefined,
  ]
    .filter((id) => id !== undefined)
    .join(" ");
  return value ? value : undefined;
}

/**
 * Pure function that merges field descriptor wiring into control props. @public
 *
 * `aria-describedby` names only the elements that actually render — the description when the
 * descriptor declares one, the error when the field is invalid — and is omitted entirely when
 * neither does, because an IDREF pointing at nothing is worse than no IDREF at all.
 */
export function fieldControlProps<T extends FieldControlProps>(props: T, field: FieldDescriptor): T {
  const invalid = field.invalid ?? false;
  const describedBy = fieldDescribedBy(field.name, {
    ...(field.scope !== undefined ? { scope: field.scope } : {}),
    ...(field.description !== undefined ? { description: field.description } : {}),
    invalid,
    ...(props["aria-describedby"] !== undefined ? { existing: props["aria-describedby"] } : {}),
  });

  return {
    ...props,
    id: props.id ?? fieldId(field.name, field.scope),
    name: props.name ?? field.name,
    disabled: props.disabled ?? field.disabled,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
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
      {...stateAttrs({ disabled, invalid, orientation })}
      class={fieldVariants({ orientation, ...(clsValue !== undefined ? { class: clsValue } : {}) })}
      {...props}>
      {children}
    </fieldset>
  );
};

export const FieldLabel: FC<PropsWithChildren<LabelProps & FieldNaming>> = ({ class: cls, for: htmlFor, name, scope, children, ...props }) => (
  <label
    data-slot='field-label'
    class={cn(FIELD_LABEL_CLASSES, asClass(cls))}
    for={htmlFor ?? (name ? fieldId(name, scope) : undefined)}
    {...props}>
    {children}
  </label>
);

export const FieldDescription: FC<PropsWithChildren<DescriptionProps & FieldNaming>> = ({ class: cls, id, name, scope, children, ...props }) => {
  const resolvedId = id ?? (name ? fieldDescriptionId(name, scope) : undefined);
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

export const FieldError: FC<PropsWithChildren<ErrorProps & FieldNaming>> = ({ class: cls, id, role, name, scope, children, ...props }) => {
  if (children == null || children === false) {
    return null;
  }

  const resolvedId = id ?? (name ? fieldErrorId(name, scope) : undefined);
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
