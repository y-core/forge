/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { CSRF_FIELD_DEFAULT, CSRF_HEADER_DEFAULT } from "../../form/constants";
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type FormProps = Omit<JSX.IntrinsicElements["form"], "children" | "method" | "hx-headers"> & {
  method?: "get" | "post" | undefined;
  "hx-headers"?: Record<string, unknown> | string | undefined;
  children?: JSXNode | undefined;
  csrfToken?: string | undefined;
  csrfField?: string | undefined;
  /** The header `csrfProtection` checks the token on, when the app renamed it. Defaults to `CSRF_HEADER_DEFAULT`. */
  csrfHeader?: string | undefined;
};

// Every entry is kept whatever its JSON type: htmx serialises a number or a boolean into the header
// just as it does a string.
function parseHxHeaders(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const HX_VERBS = ["get", "post", "put", "patch", "delete", "query"] as const;

const URL_FIELD_METHODS = new Set(["GET", "DELETE"]);

function hxAttribute(props: Record<string, unknown>, name: string): unknown {
  return props[name] ?? props[`data-${name}`];
}

function submitMethod(props: Record<string, unknown>, method: string): string {
  const verb = hxAttribute(props, "hx-action") ? undefined : HX_VERBS.find((name) => hxAttribute(props, `hx-${name}`) !== undefined);
  return String(verb ?? (hxAttribute(props, "hx-method") || method)).toUpperCase();
}

// htmx and the browser serialise a GET or DELETE form's fields into the query string, so a hidden token
// there would reach every log that records URLs; the `hx-headers` copy is the one `csrfProtection` reads.
function sendsFieldsInUrl(props: Record<string, unknown>, method: string): boolean {
  return URL_FIELD_METHODS.has(submitMethod(props, method));
}

function resolveHxHeaders(hxHeaders: FormProps["hx-headers"], csrfHeader: string, csrfToken?: string): string | undefined {
  if (!csrfToken) {
    if (typeof hxHeaders === "string") {
      return hxHeaders;
    }
    return hxHeaders ? JSON.stringify(hxHeaders) : undefined;
  }

  if (typeof hxHeaders === "string") {
    const parsed = parseHxHeaders(hxHeaders);
    // A `js:` value cannot be merged into at render time, and returning it unchanged would ship a
    // form with no CSRF token and a 403 that names nothing.
    if (!parsed) {
      throw new Error(
        `<Form> cannot merge its csrfToken into an hx-headers value that is not a JSON object (${hxHeaders}). ` +
          `Add "${csrfHeader}" to that value yourself, or drop csrfToken and render the hidden field by hand.`,
      );
    }
    return JSON.stringify({ ...parsed, [csrfHeader]: csrfToken });
  }

  if (hxHeaders && typeof hxHeaders === "object") {
    return JSON.stringify({ ...hxHeaders, [csrfHeader]: csrfToken });
  }

  return JSON.stringify({ [csrfHeader]: csrfToken });
}

/** A `<form>` that wires CSRF; a form htmx or the browser submits by GET or DELETE sends it as a header only, so a no-JS DELETE puts `hx-delete` and its own `hx-headers` on its button. @public */
export const Form: FC<PropsWithChildren<FormProps>> = ({
  csrfToken,
  csrfField = CSRF_FIELD_DEFAULT,
  csrfHeader = CSRF_HEADER_DEFAULT,
  method = "post",
  children,
  class: cls,
  "hx-headers": hxHeadersProp,
  "data-slot": inherited,
  ...props
}) => {
  const formProps = props as Record<string, unknown>;
  const resolvedHxHeaders = resolveHxHeaders(hxHeadersProp, csrfHeader, csrfToken);
  const merged = cn(cls);
  const classAttribute = merged ? { class: merged } : {};

  return (
    <form data-slot={slotToken("form", inherited)} method={method} hx-headers={resolvedHxHeaders} {...classAttribute} {...formProps}>
      {csrfToken && !sendsFieldsInUrl(formProps, method) && <input data-slot='form-csrf' type='hidden' name={csrfField} value={csrfToken} />}
      {children}
    </form>
  );
};
