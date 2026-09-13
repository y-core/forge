/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../../jsx/types";
import { Button } from "../../../ui/core/button";
import { Form } from "../../../ui/core/form";
import type { AuthSignoutProps } from "./types";

// A form and not a link: `/signout` is declared `post("/signout")` in `routes.ts`, so an anchor has
// no handler to reach — and the POST is refused without the token this carries.
/** The control that ends a session, placed wherever a host wants it — a navbar panel, a card footer. @public */
export const AuthSignout: FC<AuthSignoutProps> = ({ action, csrfToken, csrfHeader, label, tone, appearance, size, menuitem, class: cls }) => (
  <Form action={action} csrfToken={csrfToken} csrfHeader={csrfHeader}>
    <Button
      type='submit'
      role={menuitem === true ? "menuitem" : undefined}
      tone={tone ?? "neutral"}
      appearance={appearance ?? "outline"}
      size={size}
      class={cls}
      data-ref='signout'>
      {label ?? "Sign out"}
    </Button>
  </Form>
);
