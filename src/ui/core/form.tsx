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

// Every entry is kept, whatever its JSON type: htmx serialises a number or a boolean into the header
// just as it does a string, so dropping them silently loses a header the same form keeps when it
// carries no `csrfToken`.
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

function resolveHxHeaders(hxHeaders: FormProps["hx-headers"], csrfHeader: string, csrfToken?: string): string | undefined {
  if (!csrfToken) {
    if (typeof hxHeaders === "string") {
      return hxHeaders;
    }
    return hxHeaders ? JSON.stringify(hxHeaders) : undefined;
  }

  if (typeof hxHeaders === "string") {
    const parsed = parseHxHeaders(hxHeaders);
    // Returning the caller's string here would ship a form with no CSRF token at all — a 403 with
    // nothing in the markup or the console pointing at the cause, which is the failing-far-from-the-
    // cause shape ERROR_HANDLING.md §5a exists to forbid. `js:` is the realistic trigger and it
    // cannot be merged into at render time, so the caller has to add the header itself.
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

/** A `<form>` that wires CSRF for you and passes htmx attributes straight through. @public */
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
      {csrfToken && <input data-slot='form-csrf' type='hidden' name={csrfField} value={csrfToken} />}
      {children}
    </form>
  );
};
