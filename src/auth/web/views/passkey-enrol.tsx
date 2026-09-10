/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../../jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Input } from "../../../ui/core/input";
import { Link } from "../../../ui/core/link";
import { cn } from "../../../ui/core/utils/cn";
import {
  PASSKEY,
  PASSKEY_CSRF_HEADER_ATTR,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_REDIRECT_ATTR,
  PASSKEY_SCOPE,
  PASSKEY_VERIFY_PATH_ATTR,
  PASSKEY_VERIFY_TOKEN_ATTR,
} from "../../passkey-contract";
import type { AuthPasskeyContract, PasskeyEnrolViewProps } from "./types";

// Hand-rendered rather than wrapped in `Resumable` — `UI_CLIENT_RUNTIME.md` §2a.
/** The passkey ceremony's scope root, carrying the contract attributes the controller resumes on. @internal */
export const AuthPasskeyScope: FC<{ contract: AuthPasskeyContract; class?: string | undefined }> = ({ contract, class: cls, children }) => (
  <div
    data-scope={PASSKEY_SCOPE}
    {...{ [PASSKEY_MODE_ATTR]: contract.mode }}
    {...{ [PASSKEY_OPTIONS_PATH_ATTR]: contract.optionsPath }}
    {...{ [PASSKEY_VERIFY_PATH_ATTR]: contract.verifyPath }}
    {...{ [PASSKEY_OPTIONS_TOKEN_ATTR]: contract.optionsToken }}
    {...{ [PASSKEY_VERIFY_TOKEN_ATTR]: contract.verifyToken }}
    {...(contract.csrfHeader === undefined ? {} : { [PASSKEY_CSRF_HEADER_ATTR]: contract.csrfHeader })}
    {...(contract.redirect === undefined ? {} : { [PASSKEY_REDIRECT_ATTR]: contract.redirect })}
    class={cls}>
    {children}
  </div>
);

// No `aria-live` here: the page has one announcer, and the ceremony reaches it by dispatching
// `PASSKEY_OUTCOME_EVENT` on this scope root. This paragraph is the visible half only.
/** The progress line and the no-WebAuthn fallback every ceremony renders, whichever page hosts it. @internal */
export const AuthPasskeyStatus: FC<{ unsupported: string }> = ({ unsupported }) => (
  <>
    <p data-ref={PASSKEY.status} class='max-w-prose text-sm text-pretty text-muted-foreground' />
    <p data-ref={PASSKEY.unsupported} hidden class='max-w-prose text-sm text-pretty text-muted-foreground'>
      {unsupported}
    </p>
  </>
);

// Design Read: a signed-in visitor who owes a second factor; the one action is creating a passkey;
// failure is a declined or unsupported ceremony — `destructive` Alert above, trigger stays put.
/** The page a visitor lands on when the factor policy says they still owe an enrolment. @public */
export const PasskeyEnrolView: FC<PasskeyEnrolViewProps> = ({ contract, signoutPath, email, error, icon: AppIcon, class: cls, level }) => {
  const Heading = `h${level ?? 1}` as "h1";
  return (
    <Card class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Add a passkey</Heading>
        </Card.Title>
        <Card.Description>Your account needs a second factor before you can continue. Signed in as {email}.</Card.Description>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {error === undefined ? null : (
          <Alert tone='destructive'>
            <AppIcon name='alert' class='size-4' />
            <Alert.Title>Enrolment failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert>
        )}
        <AuthPasskeyScope contract={contract} class='flex flex-col gap-3'>
          <FormField name='nickname'>
            <FormField.Label name='nickname'>Name this passkey</FormField.Label>
            <Input data-ref={PASSKEY.nickname} field={{ name: "nickname", description: true }} autocomplete='off' />
            <FormField.Description name='nickname'>So you can tell your devices apart later.</FormField.Description>
          </FormField>
          <Button type='button' data-ref={PASSKEY.trigger} class='w-full'>
            <AppIcon name='key' class='size-4' />
            Create a passkey
          </Button>
          <AuthPasskeyStatus unsupported='This browser cannot create passkeys. Open this page in a current Chrome, Edge, Firefox or Safari.' />
        </AuthPasskeyScope>
      </Card.Content>
      <Card.Footer>
        <p class='max-w-prose text-sm text-pretty text-muted-foreground'>
          Not now? <Link href={signoutPath}>Sign out</Link> and finish on a device you have to hand.
        </p>
      </Card.Footer>
    </Card>
  );
};
