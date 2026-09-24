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
import type { ForgeIcon } from "../../../ui/core/types";
import { cn } from "../../../ui/core/utils/cn";
import type { SigninViewProps } from "./types";

/** The emailed-code path: one address field, submitted to the server. @internal */
const SigninEmailForm: FC<{
  submitPath: string;
  csrfToken: string;
  csrfHeader?: string | undefined;
  email: string | undefined;
  fieldError: string | undefined;
  icon: ForgeIcon<"alert">;
}> = ({ submitPath, csrfToken, csrfHeader, email, fieldError, icon: AppIcon }) => (
  <Form action={submitPath} csrfToken={csrfToken} csrfHeader={csrfHeader} class='flex flex-col gap-6'>
    <FormField name='email' invalid={fieldError !== undefined}>
      <FormField.Label name='email'>Email address</FormField.Label>
      <Input
        type='email'
        value={email}
        autocomplete='email'
        autofocus
        required
        field={{ name: "email", invalid: fieldError !== undefined, description: true }}
      />
      <FormField.Description name='email'>We send a single-use code to this address.</FormField.Description>
      {fieldError === undefined ? null : (
        <FormField.Error name='email'>
          <AppIcon name='alert' class='me-2 inline-block size-4' />
          {fieldError}
        </FormField.Error>
      )}
    </FormField>
    <Button type='submit'>Sign in</Button>
  </Form>
);

// Design Read: a returning visitor at the sign-in page; the one action is starting the sign-in with
// the primary factor; failure is a refusal — `destructive` Alert above, the typed address kept.
/** The sign-in page, whose affordance is the emailed code the primary factor asks for. @public */
export const SigninView: FC<SigninViewProps> = ({
  submitPath,
  signupPath,
  csrfToken,
  csrfHeader,
  email,
  fieldError,
  error,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  return (
    <Card class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Sign in</Heading>
        </Card.Title>
        <Card.Description>We email you a single-use code — there is no password.</Card.Description>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {error === undefined ? null : (
          <Alert tone='destructive'>
            <AppIcon name='alert' class='size-4' />
            <Alert.Title>Sign-in failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert>
        )}
        <SigninEmailForm
          submitPath={submitPath}
          csrfToken={csrfToken}
          csrfHeader={csrfHeader}
          email={email}
          fieldError={fieldError}
          icon={AppIcon}
        />
      </Card.Content>
      <Card.Footer>
        <p class='max-w-prose text-sm text-pretty text-muted-foreground'>
          <AppIcon name='mail' class='me-2 inline-block size-4' />
          No account yet? <Link href={signupPath}>Create one</Link>.
        </p>
      </Card.Footer>
    </Card>
  );
};
