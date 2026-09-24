/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { hxAttrs } from "../../../html/htmx/htmx-attrs";
import type { FC } from "../../../jsx/types";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import { Input } from "../../../ui/core/input";
import { cn } from "../../../ui/core/utils/cn";
import { AuthTimestamp } from "./timestamp";
import type { PasskeyEditViewProps } from "./types";

const UNNAMED_CREDENTIAL = "Unnamed passkey";

// Design Read: a signed-in visitor renaming one passkey; the one action is saving the new name;
// failure is a name the schema refuses — the message beside the field, what they typed still in it.
/** The rename page for one registered passkey. @public */
export const PasskeyEditView: FC<PasskeyEditViewProps> = ({
  credential,
  renamePath,
  cancelPath,
  csrfToken,
  csrfHeader,
  fieldError,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  return (
    <Card class={cn("mx-auto w-full max-w-sm", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl' data-ref='credential-label'>
            {credential.label ?? UNNAMED_CREDENTIAL}
          </Heading>
        </Card.Title>
        <Card.Description>
          <span data-ref='credential-created'>
            Added <AuthTimestamp at={credential.createdAt} />
          </span>
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <Form csrfToken={csrfToken} csrfHeader={csrfHeader} {...hxAttrs({ patch: renamePath })} class='flex flex-col gap-6'>
          <FormField name='label' invalid={fieldError !== undefined}>
            <FormField.Label name='label'>Name</FormField.Label>
            <Input value={credential.label ?? ""} autofocus field={{ name: "label", invalid: fieldError !== undefined, description: true }} />
            <FormField.Description name='label'>This is how the passkey is named in your list.</FormField.Description>
            {fieldError === undefined ? null : (
              <FormField.Error name='label'>
                <AppIcon name='alert' class='me-2 inline-block size-4' />
                {fieldError}
              </FormField.Error>
            )}
          </FormField>
          <div class='flex items-center gap-2'>
            <Button type='submit' data-ref='credential-rename-submit'>
              Save this name
            </Button>
            <Button asChild tone='neutral' appearance='outline'>
              <a href={cancelPath} data-ref='credential-rename-cancel'>
                Cancel
              </a>
            </Button>
          </div>
        </Form>
      </Card.Content>
    </Card>
  );
};
