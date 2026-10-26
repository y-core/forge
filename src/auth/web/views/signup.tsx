/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { hxAttrs } from "../../../render/htmx/htmx-attrs";
import type { FC } from "../../../render/jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import { Input } from "../../../ui/core/input";
import { Link } from "../../../ui/core/link";
import { Turnstile } from "../../../ui/core/turnstile";
import { cn } from "../../../ui/core/utils/cn";
import type { AuthFactorKind } from "../../types";
import type { SignupViewProps } from "./types";

/** The id on the sign-up view's root, which its form swaps the re-rendered view into. @public */
export const AUTH_SIGNUP_ID = "auth-signup";

/** What signing up involves, which is the emailed code plus whatever the deployment demands after it. */
function signupSteps(enrols: AuthFactorKind | undefined): string {
  const confirm = "We email you a six-digit code to confirm the address.";
  if (enrols === "passkey") return `${confirm} You choose a passkey afterwards.`;
  if (enrols === "totp-app") return `${confirm} You add an authenticator app afterwards.`;
  return confirm;
}

// Design Read: a visitor with no account; the one action is asking for a verification email; failure
// is a rejected address — `destructive` Alert above, the address kept. A passkey cannot create one.
/** The sign-up page — one address field, whatever factors the deployment offers. @public */
export const SignupView: FC<SignupViewProps> = ({
  submitPath,
  signinPath,
  csrfToken,
  csrfHeader,
  email,
  fieldError,
  error,
  enrols,
  turnstile,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  return (
    <Card id={AUTH_SIGNUP_ID} class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Create an account</Heading>
        </Card.Title>
        <Card.Description>{signupSteps(enrols)}</Card.Description>
      </Card.Header>
      <Card.Content>
        <Form
          action={submitPath}
          csrfToken={csrfToken}
          csrfHeader={csrfHeader}
          {...hxAttrs({ post: submitPath, target: `#${AUTH_SIGNUP_ID}`, swap: "outerHTML" })}
          class='flex flex-col gap-6'>
          {error === undefined ? null : (
            <Alert tone='destructive'>
              <AppIcon name='alert' class='size-4' />
              <Alert.Title>We could not use that address</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert>
          )}
          <FormField invalid={fieldError !== undefined}>
            <FormField.Label name='email'>Email address</FormField.Label>
            <Input
              type='email'
              value={email}
              autocomplete='email'
              autofocus
              required
              field={{ name: "email", error: fieldError, description: true }}
            />
            <FormField.Description name='email'>This is the address you will sign in with.</FormField.Description>
            {fieldError === undefined ? null : (
              <FormField.Error name='email'>
                <AppIcon name='alert' class='me-2 inline-block size-4' />
                {fieldError}
              </FormField.Error>
            )}
          </FormField>
          {turnstile === undefined ? null : (
            <Turnstile siteKey={turnstile.siteKey} action={turnstile.action} challenge='submit' appearance='interaction-only' />
          )}
          <Button type='submit'>Sign up</Button>
        </Form>
      </Card.Content>
      <Card.Footer>
        <p class='max-w-prose text-sm text-pretty text-muted-foreground'>
          Already have an account? <Link href={signinPath}>Sign in</Link>.
        </p>
      </Card.Footer>
    </Card>
  );
};
