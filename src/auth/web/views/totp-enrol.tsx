/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { hxAttrs } from "../../../render/htmx/htmx-attrs";
import type { FC } from "../../../render/jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Badge } from "../../../ui/core/badge";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import { Link } from "../../../ui/core/link";
import { OtpInput } from "../../../ui/core/otp-input";
import { cn } from "../../../ui/core/utils/cn";
import { AuthTimestamp } from "./timestamp";
import type { TotpEnrolViewProps } from "./types";

// The defaults are forge's own factor's, not a second opinion about it: a page mounted without the
// registry's numbers still renders the shape `createTotpAppFactor` asks for.
const DEFAULT_CODE_DIGITS = 6;
const DEFAULT_CODE_PERIOD_SECONDS = 30;

/** The id on the authenticator-app view's root in either state, which its remove form swaps the answer into. @public */
export const AUTH_TOTP_ID = "auth-totp";

const MANDATORY_ID = "totp-mandatory";

const MANDATORY_REASON = "Your account requires an authenticator app, so it can't be removed.";

const SECRET_BOX = "rounded-field border-field border-border px-3 py-2 font-mono text-sm break-all text-foreground";

// Design Read: a signed-in visitor adding an authenticator app; the one action is confirming the code
// the app shows; failure is a code that does not match — the field's error, the secret still on screen.
/** The authenticator-app page: the once-only secret and its confirmation, or the settled enrolment. @public */
export const TotpEnrolView: FC<TotpEnrolViewProps> = ({
  state,
  enrolPath,
  removePath,
  replacePath,
  csrfToken,
  csrfHeader,
  mandatory,
  codeDigits,
  codePeriodSeconds,
  fieldError,
  error,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  const digits = codeDigits ?? DEFAULT_CODE_DIGITS;
  const period = codePeriodSeconds ?? DEFAULT_CODE_PERIOD_SECONDS;
  return state.status === "enrolled" ? (
    <Card id={AUTH_TOTP_ID} class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Your authenticator app</Heading>
        </Card.Title>
        <Card.Description>
          <span data-ref='totp-enrolled'>
            Confirmed <AuthTimestamp at={state.enrolledAt} />
          </span>
        </Card.Description>
        <Card.Action>
          <Badge tone='success' data-ref='totp-status'>
            Enrolled
          </Badge>
        </Card.Action>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {error === undefined ? null : (
          <Alert tone='destructive' data-ref='totp-error'>
            <AppIcon name='alert' class='size-4' />
            <Alert.Title>We could not remove your authenticator app</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert>
        )}
        {replacePath === undefined ? null : (
          <Link href={replacePath} decoration='hover' class='self-start' data-ref='totp-replace'>
            Replace authenticator app
          </Link>
        )}
        {removePath === undefined ? null : (
          <Form
            csrfToken={csrfToken}
            csrfHeader={csrfHeader}
            class='flex flex-col items-start gap-2'
            {...hxAttrs({ delete: removePath, target: `#${AUTH_TOTP_ID}`, swap: "outerHTML" })}>
            {mandatory ? (
              <span id={MANDATORY_ID} data-ref='totp-mandatory' class='text-sm text-muted-foreground'>
                {MANDATORY_REASON}
                {replacePath === undefined ? null : (
                  <>
                    {" "}
                    <Link href={replacePath} data-ref='totp-mandatory-replace'>
                      Replace it instead.
                    </Link>
                  </>
                )}
              </span>
            ) : null}
            <Button
              type='submit'
              tone='destructive'
              appearance='outline'
              data-ref='totp-remove'
              disabled={mandatory}
              aria-describedby={mandatory ? MANDATORY_ID : undefined}>
              Remove authenticator app
            </Button>
          </Form>
        )}
      </Card.Content>
    </Card>
  ) : (
    <Card id={AUTH_TOTP_ID} class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>{state.status === "replacing" ? "Replace your authenticator app" : "Add an authenticator app"}</Heading>
        </Card.Title>
        <Card.Description>
          <span data-ref='totp-once'>Store this secret in your app now. It is shown on this page only, and never again.</span>{" "}
          {state.status === "replacing" ? (
            <span data-ref='totp-replacing'>Your current app keeps working until you confirm a code from the new one.</span>
          ) : (
            // A stale entry still shows codes, and one read from it is refused — which reads as "my app is broken" unless the page says this first.
            <span data-ref='totp-replaces'>
              If your app already holds an entry for this account, replace it. Codes from the old entry are no longer accepted.
            </span>
          )}
        </Card.Description>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {error === undefined ? null : (
          <Alert tone='destructive' data-ref='totp-error'>
            <AppIcon name='alert' class='size-4' />
            <Alert.Title>Your authenticator app changed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert>
        )}
        <div class='flex flex-col gap-2'>
          <span class='text-sm text-muted-foreground'>Secret</span>
          <code data-ref='totp-secret' class={SECRET_BOX}>
            {state.secret}
          </code>
        </div>
        <div class='flex flex-col gap-2'>
          <span class='text-sm text-muted-foreground'>Setup link</span>
          <code data-ref='totp-uri' class={SECRET_BOX}>
            {state.uri}
          </code>
        </div>
        <Form action={enrolPath} csrfToken={csrfToken} csrfHeader={csrfHeader} class='flex flex-col gap-6'>
          <FormField invalid={fieldError !== undefined}>
            <FormField.Label name='code'>Code from your app</FormField.Label>
            <OtpInput length={digits} invalid={fieldError !== undefined} field={{ name: "code", error: fieldError, description: true }} />
            <FormField.Description name='code'>{`${digits} digits, refreshed by the app every ${period} seconds.`}</FormField.Description>
            {fieldError === undefined ? null : (
              <FormField.Error name='code'>
                <AppIcon name='alert' class='me-2 inline-block size-4' />
                {fieldError}
              </FormField.Error>
            )}
          </FormField>
          <Button type='submit' data-ref='totp-confirm'>
            Confirm the code
          </Button>
        </Form>
      </Card.Content>
    </Card>
  );
};
