/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";

type FormProps = Omit<JSX.IntrinsicElements["form"], "children" | "method" | "hx-headers"> & {
  method?: "get" | "post";
  "hx-headers"?: Record<string, string> | string;
  children?: JSXNode;
  csrfToken?: string;
  csrfField?: string;
  honeypotField?: string;
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

export const Form: FC<PropsWithChildren<FormProps>> = ({
  csrfToken,
  csrfField = "_csrf",
  honeypotField = "surname",
  method = "post",
  children,
  "hx-headers": hxHeadersProp,
  ...props
}) => {
  const formProps = props as Record<string, unknown>;
  const resolvedHxHeaders = resolveHxHeaders(hxHeadersProp, csrfToken);

  return (
    <form data-slot='form' method={method} {...(resolvedHxHeaders !== undefined ? { "hx-headers": resolvedHxHeaders } : {})} {...formProps}>
      {csrfToken && <input data-slot='form-csrf' type='hidden' name={csrfField} value={csrfToken} />}
      <div aria-hidden='true' data-slot='form-honeypot' class='absolute -left-[9999px] opacity-0 pointer-events-none'>
        <input type='text' name={honeypotField} tabindex={-1} autocomplete='off' />
      </div>
      {children}
    </form>
  );
};
