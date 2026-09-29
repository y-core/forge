/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../../jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import { Input } from "../../../ui/core/input";
import type { ForgeIcon } from "../../../ui/core/types";
import { cn } from "../../../ui/core/utils/cn";
import type { RecoveryCodesViewProps } from "./types";

const CODE_BLOCK = "rounded-field border-field border-border px-3 py-2 font-mono text-sm text-foreground select-all";

/** The single field a recovery code is typed into, shared by the verify page and the confirmation below. @internal */
export const RecoveryCodeField: FC<{ fieldError: string | undefined; icon: ForgeIcon<"alert"> }> = ({ fieldError, icon: AppIcon }) => (
  <FormField name='code' invalid={fieldError !== undefined}>
    <FormField.Label name='code'>Recovery code</FormField.Label>
    <Input
      type='text'
      autocomplete='off'
      spellcheck={false}
      required
      field={{ name: "code", invalid: fieldError !== undefined, description: true }}
    />
    <FormField.Description name='code'>Spaces, dashes and letter case are ignored.</FormField.Description>
    {fieldError === undefined ? null : (
      <FormField.Error name='code'>
        <AppIcon name='alert' class='me-2 inline-block size-4' />
        {fieldError}
      </FormField.Error>
    )}
  </FormField>
);

/** What the page says about the codes the account already holds. */
function standingNote(remaining: number | null): string {
  if (remaining === null) return "You have no recovery codes yet.";
  if (remaining === 1) return "You have 1 unused recovery code left.";
  return `You have ${remaining} unused recovery codes left.`;
}

// Design Read: a signed-in visitor who has just stepped up, keeping a way back in; the one action is
// generating a set and typing one back; failure is a code that is not in the set — the field's error.
/** The recovery-code page: the codes left, and a new set shown once until one of it is typed back. @public */
export const RecoveryCodesView: FC<RecoveryCodesViewProps> = ({
  remaining,
  generatePath,
  generateToken,
  issued,
  confirmPath,
  confirmToken,
  csrfHeader,
  fieldError,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  const confirming = issued !== undefined || fieldError !== undefined;
  return (
    <Card class={cn("mx-auto w-full max-w-md", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Recovery codes</Heading>
        </Card.Title>
        <Card.Description>
          <span data-ref='recovery-remaining'>{standingNote(remaining)}</span> Each code signs you in once when your other methods are out of reach.
        </Card.Description>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {issued === undefined ? null : (
          <div class='flex flex-col gap-3'>
            <Alert tone='warning' data-ref='recovery-once'>
              <AppIcon name='key' class='size-4' />
              <Alert.Title>Copy these codes now</Alert.Title>
              <Alert.Description data-ref='recovery-keep-safe'>
                Keep them somewhere safe, such as a password manager. They won't be shown again. Your old codes keep working until you type one of
                these back.
              </Alert.Description>
            </Alert>
            <pre data-ref='recovery-codes' class={CODE_BLOCK}>
              {issued.join("\n")}
            </pre>
          </div>
        )}
        {!confirming ? null : (
          <Form action={confirmPath} csrfToken={confirmToken} csrfHeader={csrfHeader} class='flex flex-col gap-6' data-ref='recovery-confirm'>
            <RecoveryCodeField fieldError={fieldError} icon={AppIcon} />
            <Button type='submit'>Confirm the new codes</Button>
          </Form>
        )}
        <Form action={generatePath} csrfToken={generateToken} csrfHeader={csrfHeader} data-ref='recovery-generate'>
          <Button type='submit' tone={confirming ? "neutral" : "primary"} appearance={confirming ? "ghost" : "solid"}>
            {remaining === null && !confirming ? "Generate recovery codes" : "Generate a new set"}
          </Button>
        </Form>
      </Card.Content>
    </Card>
  );
};
