/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { hxAttrs } from "../../../html/htmx/htmx-attrs";
import type { FC } from "../../../jsx/types";
import { Badge } from "../../../ui/core/badge";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import type { ForgeIcon } from "../../../ui/core/icon";
import { OtpInput } from "../../../ui/core/otp-input";
import { cn } from "../../../ui/core/utils/cn";
import type { TotpAppEnrolment } from "../../factors/totp-app";
import { AuthTimestamp } from "./timestamp";
import type { AuthViewChrome } from "./types";

const CODE_LENGTH = 6;

const SECRET_BOX = "rounded-field border-field border-border px-3 py-2 font-mono text-sm break-all text-foreground";

/** Which of the authenticator app's two page states is rendering; only the enrolling one carries the secret. @public */
export type TotpEnrolState = ({ readonly status: "enrolling" } & TotpAppEnrolment) | { readonly status: "enrolled"; readonly enrolledAt: number };

/** What the authenticator-app page renders. @public */
export type TotpEnrolViewProps = AuthViewChrome & {
  readonly state: TotpEnrolState;
  /** Where the confirmation code is posted. */
  readonly enrolPath: string;
  // Absent on the page an owed enrolment lands on: there is nothing enrolled there to take away, and
  // a session owing a step-up must not be able to remove the factor that would satisfy it.
  /** Where the settled enrolment is deleted, absent where removal is not offered. */
  readonly removePath?: string | undefined;
  readonly csrfToken: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  /** Copy for a rejected confirmation code; the view owns the wording, since `describeValidationIssue` returns only a field name. */
  readonly fieldError?: string | undefined;
  readonly icon: ForgeIcon<"alert">;
};

// Design Read: a signed-in visitor adding an authenticator app; the one action is confirming the code
// the app shows; failure is a code that does not match — the field's error, the secret still on screen.
/** The authenticator-app page: the once-only secret and its confirmation, or the settled enrolment. @public */
export const TotpEnrolView: FC<TotpEnrolViewProps> = ({
  state,
  enrolPath,
  removePath,
  csrfToken,
  csrfHeader,
  fieldError,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  return state.status === "enrolled" ? (
    <Card class={cn("mx-auto w-full max-w-md", cls)}>
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
      <Card.Content>
        {removePath === undefined ? null : (
          <Form csrfToken={csrfToken} csrfHeader={csrfHeader} {...hxAttrs({ delete: removePath })}>
            <Button type='submit' tone='destructive' appearance='outline' data-ref='totp-remove'>
              Remove authenticator app
            </Button>
          </Form>
        )}
      </Card.Content>
    </Card>
  ) : (
    <Card class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Add an authenticator app</Heading>
        </Card.Title>
        <Card.Description>Store this secret in your app now. It is shown on this page only, and never again.</Card.Description>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
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
          <FormField name='code' invalid={fieldError !== undefined}>
            <FormField.Label name='code'>Code from your app</FormField.Label>
            <OtpInput
              length={CODE_LENGTH}
              invalid={fieldError !== undefined}
              field={{ name: "code", invalid: fieldError !== undefined, description: true }}
            />
            <FormField.Description name='code'>Six digits, refreshed by the app every thirty seconds.</FormField.Description>
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
