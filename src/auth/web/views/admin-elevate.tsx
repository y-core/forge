/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../../jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import { Input } from "../../../ui/core/input";
import { cn } from "../../../ui/core/utils/cn";
import type { AdminElevateViewProps } from "./types";

const TAKEN_ID = "admin-elevate-reason";

const TAKEN_REASON = "This deployment already has an administrator, so the first-admin claim is closed. Ask one of them to grant you the role.";

// Design Read: a signed-in visitor bootstrapping a deployment with no administrator; the one action
// is claiming the role; failure is one that already has it — a `warning` Alert over a disabled confirm.
/** The first-admin claim: one explicit confirmation, disabled with its reason once an admin exists. @public */
export const AdminElevateView: FC<AdminElevateViewProps> = ({
  adminCount,
  paths,
  csrfToken,
  csrfHeader,
  fieldError,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const taken = adminCount > 0;
  const Heading = `h${level ?? 1}` as "h1";

  return (
    <Card class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Claim the administrator role</Heading>
        </Card.Title>
        <Card.Description>An administrator can promote, deactivate and delete every account in this deployment.</Card.Description>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {taken ? (
          <Alert id={TAKEN_ID} tone='warning' data-ref='elevate-taken'>
            <AppIcon name='alert' class='size-4' />
            <Alert.Title>The claim is closed</Alert.Title>
            <Alert.Description>{TAKEN_REASON}</Alert.Description>
          </Alert>
        ) : null}
        <Form action={paths.elevate.submit()} csrfToken={csrfToken} csrfHeader={csrfHeader} class='flex flex-col gap-2'>
          <input type='hidden' name='confirm' value='yes' />
          <FormField name='secret' invalid={fieldError !== undefined}>
            <FormField.Label name='secret'>Bootstrap secret</FormField.Label>
            <Input
              type='password'
              autocomplete='off'
              required
              disabled={taken}
              data-ref='elevate-secret'
              field={{ name: "secret", invalid: fieldError !== undefined, description: true }}
            />
            <FormField.Description name='secret'>
              The secret this deployment was configured with. Without one configured there is no claim to make.
            </FormField.Description>
            {fieldError === undefined ? null : (
              <FormField.Error name='secret'>
                <AppIcon name='alert' class='me-2 inline-block size-4' />
                {fieldError}
              </FormField.Error>
            )}
          </FormField>
          <Button type='submit' class='self-start' disabled={taken} data-ref='elevate-submit' aria-describedby={taken ? TAKEN_ID : undefined}>
            Make me an administrator
          </Button>
        </Form>
      </Card.Content>
    </Card>
  );
};
