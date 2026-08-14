/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { CSRF_FIELD_DEFAULT } from "../../form/constants";
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type FormProps = Omit<JSX.IntrinsicElements["form"], "children" | "method" | "hx-headers"> & {
  method?: "get" | "post";
  "hx-headers"?: Record<string, string> | string;
  children?: JSXNode;
  csrfToken?: string;
  csrfField?: string;
};

function parseHxHeaders(value: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const headers: Record<string, string> = {};
    for (const [key, headerValue] of Object.entries(parsed)) {
      if (typeof headerValue === "string") {
        headers[key] = headerValue;
      }
    }
    return headers;
  } catch {
    return null;
  }
}

function resolveHxHeaders(hxHeaders: FormProps["hx-headers"], csrfToken?: string): string | undefined {
  if (!csrfToken) {
    if (typeof hxHeaders === "string") {
      return hxHeaders;
    }
    return hxHeaders ? JSON.stringify(hxHeaders) : undefined;
  }

  if (typeof hxHeaders === "string") {
    const parsed = parseHxHeaders(hxHeaders);
    if (!parsed) {
      return hxHeaders;
    }
    return JSON.stringify({ ...parsed, "X-CSRF-Token": csrfToken });
  }

  if (hxHeaders && typeof hxHeaders === "object") {
    return JSON.stringify({ ...hxHeaders, "X-CSRF-Token": csrfToken });
  }

  return JSON.stringify({ "X-CSRF-Token": csrfToken });
}

/** A `<form>` that wires CSRF for you and passes htmx attributes straight through. @public */
export const Form: FC<PropsWithChildren<FormProps>> = ({
  csrfToken,
  csrfField = CSRF_FIELD_DEFAULT,
  method = "post",
  children,
  class: cls,
  "hx-headers": hxHeadersProp,
  "data-slot": inherited,
  ...props
}) => {
  const formProps = props as Record<string, unknown>;
  const resolvedHxHeaders = resolveHxHeaders(hxHeadersProp, csrfToken);
  const merged = cn(cls);
  const classAttribute = merged ? { class: merged } : {};

  return (
    <form
      data-slot={slotToken("form", inherited)}
      method={method}
      {...(resolvedHxHeaders !== undefined ? { "hx-headers": resolvedHxHeaders } : {})}
      {...classAttribute}
      {...formProps}>
      {csrfToken && <input data-slot='form-csrf' type='hidden' name={csrfField} value={csrfToken} />}
      {children}
    </form>
  );
};
