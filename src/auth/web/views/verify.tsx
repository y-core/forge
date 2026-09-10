/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../../jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import { Link } from "../../../ui/core/link";
import { OtpInput } from "../../../ui/core/otp-input";
import { cn } from "../../../ui/core/utils/cn";
import { AUTH_OTP_DIGITS } from "../../config";
import { PASSKEY } from "../../passkey-contract";
import type { AuthFactorKind } from "../../types";
import { AuthPasskeyScope, AuthPasskeyStatus } from "./passkey-enrol";
import type { VerifyViewProps } from "./types";

const SECOND_MS = 1000;
const MINUTE_SECONDS = 60;

/** The factor's wait in the words a visitor reads it in. */
function waitFor(ms: number): string {
  const seconds = Math.round(ms / SECOND_MS);
  if (seconds < MINUTE_SECONDS) return `${seconds} seconds`;
  const minutes = Math.round(seconds / MINUTE_SECONDS);
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
}

// "If another code was due" and never "we sent one": a page that reported the difference would be
// telling an anonymous visitor whether the address it just named has an account here.
/** What the page says after a resend — the policy, never what became of this particular request. */
function resentNotice(reissueAfterMs: number | undefined): string {
  const asked = "If another code was due, it is on its way — check your inbox.";
  return reissueAfterMs === undefined ? asked : `${asked} You can ask again in ${waitFor(reissueAfterMs)}.`;
}

/** How the page names the factor it is asking the visitor to present. */
const PROMPT: Record<AuthFactorKind, string> = {
  "email-otp": "Enter the code we emailed you.",
  "totp-app": "Enter the current code from your authenticator app.",
  passkey: "Confirm with the passkey saved on this device.",
};

// Design Read: a visitor mid-sign-in asked for a second factor; the one action is presenting it;
// failure is a wrong or expired code — the field carries it, a refused attempt a `destructive` Alert.
/** The verification page, whose affordance is the code field or a ceremony, per the factor. @public */
export const VerifyView: FC<VerifyViewProps> = ({
  factor,
  codeDigits,
  passkey,
  submitPath,
  resendPath,
  signinPath,
  csrfToken,
  resendToken,
  resent,
  reissueAfterMs,
  csrfHeader,
  email,
  fieldError,
  error,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  const digits = codeDigits ?? AUTH_OTP_DIGITS;
  return (
    <Card class={cn("mx-auto w-full max-w-sm", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Confirm it&#39;s you</Heading>
        </Card.Title>
        <Card.Description>
          {PROMPT[factor]}
          {factor === "email-otp" && email !== undefined ? ` Sent to ${email}.` : ""}
        </Card.Description>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {error === undefined ? null : (
          <Alert tone='destructive'>
            <AppIcon name='alert' class='size-4' />
            <Alert.Title>We could not confirm that</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert>
        )}
        {factor === "passkey" && passkey !== undefined ? (
          <AuthPasskeyScope contract={passkey} class='flex flex-col gap-3'>
            <Button type='button' data-ref={PASSKEY.trigger} class='w-full'>
              <AppIcon name='key' class='size-4' />
              Confirm with a passkey
            </Button>
            <AuthPasskeyStatus unsupported='This browser cannot use passkeys. Open this page in a current Chrome, Edge, Firefox or Safari.' />
          </AuthPasskeyScope>
        ) : (
          <Form action={submitPath} csrfToken={csrfToken} csrfHeader={csrfHeader} class='flex flex-col gap-6'>
            <FormField name='code' invalid={fieldError !== undefined}>
              <FormField.Label name='code'>Verification code</FormField.Label>
              <OtpInput
                length={digits}
                autofocus
                autocomplete='one-time-code'
                field={{ name: "code", invalid: fieldError !== undefined, description: true }}
              />
              <FormField.Description name='code'>{digits} digits. Spaces and dashes are ignored.</FormField.Description>
              {fieldError === undefined ? null : (
                <FormField.Error name='code'>
                  <AppIcon name='alert' class='me-2 inline-block size-4' />
                  {fieldError}
                </FormField.Error>
              )}
            </FormField>
            <Button type='submit'>Confirm</Button>
          </Form>
        )}
        {resendPath === undefined || resendToken === undefined || factor !== "email-otp" ? null : (
          <div class='flex flex-col gap-3'>
            {!resent ? null : (
              <Alert tone='info' data-ref='verify-resent'>
                <AppIcon name='mail' class='size-4' />
                <Alert.Description>{resentNotice(reissueAfterMs)}</Alert.Description>
              </Alert>
            )}
            <Form action={resendPath} csrfToken={resendToken} csrfHeader={csrfHeader}>
              <Button type='submit' tone='neutral' appearance='ghost' class='w-full' disabled={resent} data-ref='verify-resend'>
                <AppIcon name='mail' class='size-4' />
                Send another code
              </Button>
            </Form>
          </div>
        )}
      </Card.Content>
      <Card.Footer>
        <p class='max-w-prose text-sm text-pretty text-muted-foreground'>
          Wrong address? <Link href={signinPath}>Start again</Link>.
        </p>
      </Card.Footer>
    </Card>
  );
};
