import type { Child, FC, JSX, PropsWithChildren } from "hono/jsx";
import { CSRF_FIELD_DEFAULT, HONEYPOT_FIELD_DEFAULT } from "../../form/constants";

type PrimitiveFormValue = boolean | number | string | undefined;

type FormProps = Omit<JSX.IntrinsicElements["form"], "children" | "method"> & {
  method?: "get" | "post";
  "hx-headers"?: Record<string, string> | string;
  children?: Child;
  csrfToken?: string;
  honeypotField?: string;
} & {
  [key: `data-${string}`]: PrimitiveFormValue;
} & {
  [key: `hx-${string}`]: PrimitiveFormValue;
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

function resolveHxHeaders(
  hxHeaders: FormProps["hx-headers"],
  csrfToken?: string,
): string | undefined {
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
  honeypotField = HONEYPOT_FIELD_DEFAULT,
  method = "post",
  children,
  "hx-headers": hxHeadersProp,
  ...props
}) => {
  const formProps = props as Record<string, unknown>;

  return (
    <form
      data-slot="form"
      method={method}
      hx-headers={resolveHxHeaders(hxHeadersProp, csrfToken)}
      {...formProps}
    >
      {csrfToken && (
        <input
          data-slot="form-csrf"
          type="hidden"
          name={CSRF_FIELD_DEFAULT}
          value={csrfToken}
        />
      )}
      <div
        aria-hidden="true"
        data-slot="form-honeypot"
        class="absolute -left-[9999px] opacity-0 pointer-events-none"
      >
        <input
          type="text"
          name={honeypotField}
          tabindex={-1}
          autocomplete="off"
        />
      </div>
      {children}
    </form>
  );
};
