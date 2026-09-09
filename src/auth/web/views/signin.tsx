/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../../jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import type { ForgeIcon } from "../../../ui/core/icon";
import { Input } from "../../../ui/core/input";
import { Link } from "../../../ui/core/link";
import { Separator } from "../../../ui/core/separator";
import { cn } from "../../../ui/core/utils/cn";
import { PASSKEY } from "../../passkey-contract";
import type { AuthFactorKind } from "../../types";
import { type AuthPasskeyContract, AuthPasskeyScope, AuthPasskeyStatus } from "./passkey-enrol";
import type { AuthViewChrome } from "./types";

/** What the sign-in page renders. @public */
export type SigninViewProps = AuthViewChrome & {
  /** The factor that starts a sign-in. Never `totp-app`, which proves possession but identifies nobody. */
  readonly primaryFactor: AuthFactorKind;
  /** The ceremony contract, present exactly when a passkey can sign this deployment in. */
  readonly passkey?: AuthPasskeyContract | undefined;
  readonly submitPath: string;
  readonly signupPath: string;
  readonly csrfToken: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  /** The address the visitor already typed, so a refusal does not empty the field. */
  readonly email?: string | undefined;
  /** A refusal about the address itself, in this view's own words — `describeValidationIssue` names a field and nothing more. */
  readonly fieldError?: string | undefined;
  /** A refusal about the attempt as a whole: a rate limit, a refused ceremony. */
  readonly error?: string | undefined;
  readonly icon: ForgeIcon<"alert" | "key" | "mail">;
};

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
    <Button type='submit'>Email me a code</Button>
  </Form>
);

/** The passkey path: a scope root the browser controller resumes on. @internal */
const SigninPasskey: FC<{ passkey: AuthPasskeyContract; icon: ForgeIcon<"key">; primary: boolean }> = ({ passkey, icon: AppIcon, primary }) => (
  <AuthPasskeyScope contract={passkey} class='flex flex-col gap-3'>
    <Button
      type='button'
      data-ref={PASSKEY.trigger}
      class='w-full'
      {...(primary ? {} : { tone: "neutral" as const, appearance: "outline" as const })}>
      <AppIcon name='key' class='size-4' />
      Use a passkey
    </Button>
    <AuthPasskeyStatus unsupported='This browser cannot use passkeys. Open this page in a current Chrome, Edge, Firefox or Safari.' />
  </AuthPasskeyScope>
);

// Design Read: a returning visitor at the sign-in page; the one action is starting the sign-in with
// the primary factor; failure is a refusal — `destructive` Alert above, the typed address kept.
/** The sign-in page, whose primary affordance is whichever factor the deployment made primary. @public */
export const SigninView: FC<SigninViewProps> = ({
  primaryFactor,
  passkey,
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
  const passkeyIsPrimary = primaryFactor === "passkey";
  const Heading = `h${level ?? 1}` as "h1";
  return (
    <Card class={cn("mx-auto w-full max-w-sm", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Sign in</Heading>
        </Card.Title>
        <Card.Description>
          {passkeyIsPrimary ? "Use the passkey you saved on this device." : "We email you a single-use code — there is no password."}
        </Card.Description>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {error === undefined ? null : (
          <Alert tone='destructive'>
            <AppIcon name='alert' class='size-4' />
            <Alert.Title>Sign-in failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert>
        )}
        {passkeyIsPrimary && passkey !== undefined ? (
          <SigninPasskey passkey={passkey} icon={AppIcon} primary />
        ) : (
          <SigninEmailForm
            submitPath={submitPath}
            csrfToken={csrfToken}
            csrfHeader={csrfHeader}
            email={email}
            fieldError={fieldError}
            icon={AppIcon}
          />
        )}
        {!passkeyIsPrimary && passkey !== undefined ? (
          <div class='flex flex-col gap-3'>
            <Separator />
            <SigninPasskey passkey={passkey} icon={AppIcon} primary={false} />
          </div>
        ) : null}
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
