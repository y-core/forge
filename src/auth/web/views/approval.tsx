/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import type { FC } from "../../../render/jsx/types";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import { Input } from "../../../ui/core/input";
import { Turnstile } from "../../../ui/core/turnstile";
import { cn } from "../../../ui/core/utils/cn";
import type { ApprovalViewProps } from "./types";

// Design Read: a visitor stopped on the way to a route that needs an administrator's say-so; the one
// action is presenting the code; failure is a refused code — the field error, the form kept.
/** The administrator approval prompt: one code field and, when configured, a challenge. @public */
export const ApprovalView: FC<ApprovalViewProps> = ({ submitPath, csrfToken, csrfHeader, fieldError, turnstile, class: cls, level }) => {
  const Heading = `h${level ?? 1}` as "h1";
  return (
    <Card class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Administrator approval</Heading>
        </Card.Title>
        <Card.Description>Enter a valid administrator code to continue.</Card.Description>
      </Card.Header>
      <Card.Content>
        <Form action={submitPath} csrfToken={csrfToken} csrfHeader={csrfHeader} class='flex flex-col gap-6'>
          <FormField name='code' invalid={fieldError !== undefined}>
            <FormField.Label name='code'>Administrator code</FormField.Label>
            <Input
              type='password'
              autocomplete='off'
              autofocus
              required
              data-ref='approval-code'
              field={{ name: "code", invalid: fieldError !== undefined }}
            />
            {fieldError === undefined ? null : <FormField.Error name='code'>{fieldError}</FormField.Error>}
          </FormField>
          {turnstile === undefined ? null : (
            <Turnstile siteKey={turnstile.siteKey} action={turnstile.action} challenge='submit' appearance='interaction-only' />
          )}
          <Button type='submit' data-ref='approval-submit'>
            Continue
          </Button>
        </Form>
      </Card.Content>
    </Card>
  );
};
