/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import type { FC } from "../../../render/jsx/types";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { Form } from "../../../ui/core/form";
import { cn } from "../../../ui/core/utils/cn";
import type { AuthSignoutProps, SignoutConfirmViewProps } from "./types";

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

/** The page a sign-out its token could not authorise lands on, with a freshly minted one. @public */
export const SignoutConfirmView: FC<SignoutConfirmViewProps> = ({ submitPath, csrfToken, csrfHeader, class: cls, level }) => {
  const Heading = `h${level ?? 1}` as "h1";

  return (
    <Card class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Sign out</Heading>
        </Card.Title>
        <Card.Description>End your session on this device.</Card.Description>
      </Card.Header>
      <Card.Content>
        <AuthSignout action={submitPath} csrfToken={csrfToken} csrfHeader={csrfHeader} tone='primary' appearance='solid' />
      </Card.Content>
    </Card>
  );
};
