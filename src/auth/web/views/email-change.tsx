/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../../jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import { Input } from "../../../ui/core/input";
import { Link } from "../../../ui/core/link";
import { cn } from "../../../ui/core/utils/cn";
import type { EmailChangeViewProps } from "./types";

// Design Read: a signed-in visitor changing the address they sign in with; the one action is
// requesting it; failure is a rejected address — `destructive` Alert above, the typed address kept.
/** The email-change page: request a change, then wait for the confirmation to be clicked. @public */
export const EmailChangeView: FC<EmailChangeViewProps> = ({
  currentEmail,
  submitPath,
  accountPath,
  csrfToken,
  csrfHeader,
  email,
  fieldError,
  error,
  sentTo,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  return (
    <Card class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Change your email address</Heading>
        </Card.Title>
        <Card.Description>You sign in with {currentEmail} today. The change takes effect once you confirm the new address.</Card.Description>
      </Card.Header>
      <Card.Content>
        {sentTo === undefined ? (
          <Form action={submitPath} csrfToken={csrfToken} csrfHeader={csrfHeader} class='flex flex-col gap-6'>
            {error === undefined ? null : (
              <Alert tone='destructive'>
                <AppIcon name='alert' class='size-4' />
                <Alert.Title>We could not use that address</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert>
            )}
            <FormField name='email' invalid={fieldError !== undefined}>
              <FormField.Label name='email'>New email address</FormField.Label>
              <Input
                type='email'
                value={email}
                autocomplete='email'
                autofocus
                required
                field={{ name: "email", invalid: fieldError !== undefined, description: true }}
              />
              <FormField.Description name='email'>We send a confirmation link there. Nothing changes until you open it.</FormField.Description>
              {fieldError === undefined ? null : (
                <FormField.Error name='email'>
                  <AppIcon name='alert' class='me-2 inline-block size-4' />
                  {fieldError}
                </FormField.Error>
              )}
            </FormField>
            <Button type='submit'>Send the confirmation link</Button>
          </Form>
        ) : (
          <Alert tone='success'>
            <AppIcon name='mail' class='size-4' />
            <Alert.Title>Confirmation sent</Alert.Title>
            <Alert.Description>
              Open the link we sent to {sentTo}. Until then you keep signing in with {currentEmail}.
            </Alert.Description>
          </Alert>
        )}
      </Card.Content>
      <Card.Footer>
        <p class='max-w-prose text-sm text-pretty text-muted-foreground'>
          <Link href={accountPath}>Back to your account</Link>
        </p>
      </Card.Footer>
    </Card>
  );
};
