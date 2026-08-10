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

/** HTML's ASCII whitespace set — the characters an id may not contain and the ones an IDREF list is
 * split on. Deliberately not JS `\s`, which also matches U+00A0 and the Unicode spaces: those are
 * legal id characters that no parser treats as a token separator, so folding them in here would
 * suppress ids that resolve perfectly well. @internal */
const ASCII_WS = /[\t\n\f\r ]/;

/** The blank test for the same set as {@link ASCII_WS} — again not JS `\s`, for the same reason: a
 * value of only non-breaking spaces is a real, resolvable id, not a blank one. @internal */
const ASCII_WS_ONLY = /^[\t\n\f\r ]*$/;

/** Whether a value can stand as a whole id token: non-empty, and free of {@link ASCII_WS}. @internal */
function idToken(value: string): boolean {
  return value !== "" && !ASCII_WS.test(value);
}

/** Whether an id can be derived for this field at all. `name` must be an id token. A blank `scope`
 * is no scope; a non-blank one must be an id token too — falling back to the unscoped id instead
 * would collide with the very field the scope exists to be distinguished from. Every site that
 * derives an id or an IDREF routes through this, which is what keeps a control's
 * `aria-describedby` and the compound members' ids agreeing. @internal */
function derivable(name: string | undefined, scope?: string): name is string {
  return name !== undefined && idToken(name) && (scope === undefined || ASCII_WS_ONLY.test(scope) || idToken(scope));
}

/** The control's id. `scope` separates two fields that share a name on one page; a blank one is no
 * scope. */
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
 *
 * The `name` and `scope` must each be a single id token — see {@link fieldControlProps}.
 */
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

/**
 * Pure function that merges field descriptor wiring into control props. @public
 *
 * `aria-describedby` names only the elements that actually render — the description when the
 * descriptor declares one, the error when the field is invalid — and is omitted entirely when
 * neither does, because an IDREF pointing at nothing is worse than no IDREF at all.
 *
 * The `name`, and any non-blank `scope`, must each be a single id token: anything containing ASCII
 * whitespace derives no `id` and no `aria-describedby`, because HTML forbids ASCII whitespace in an
 * id and splits every IDREF list on it. That matches the compound members; the `name` attribute
 * itself is still passed through as given.
 */
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
  // cva's `class` is `class?: string` (no `undefined`), so omit it rather than pass undefined.
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
      class={cn("text-sm font-normal text-red-600", asClass(cls))}
      {...(resolvedId !== undefined ? { id: resolvedId } : {})}
      role={role ?? "alert"}
      {...props}>
      {children}
    </p>
  );
};
