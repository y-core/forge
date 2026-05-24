import type { FC, PropsWithChildren } from "hono/jsx";
import { CSRF_FIELD_DEFAULT, HONEYPOT_FIELD_DEFAULT } from "../../security/constants";

interface FormProps {
  formId?: string;
  "hx-post"?: string;
  "hx-target"?: string;
  "hx-swap"?: string;
  "hx-encoding"?: string;
  "hx-disabled-elt"?: string;
  "hx-indicator"?: string;
  "hx-headers"?: string;
  novalidate?: boolean;
  csrfToken?: string;
  honeypotField?: string;
  class?: string;
  "data-ref"?: string;
}

export const Form: FC<PropsWithChildren<FormProps>> = ({
  formId,
  csrfToken,
  honeypotField = HONEYPOT_FIELD_DEFAULT,
  class: cls,
  children,
  "hx-headers": hxHeadersProp,
  ...htmxProps
}) => {
  const hxHeaders = csrfToken
    ? JSON.stringify({ "X-CSRF-Token": csrfToken })
    : hxHeadersProp;

  return (
    <form
      id={formId}
      method="post"
      class={cls}
      hx-headers={hxHeaders}
      {...htmxProps}
    >
      {csrfToken && (
        <input type="hidden" name={CSRF_FIELD_DEFAULT} value={csrfToken} />
      )}
      <div
        aria-hidden="true"
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
