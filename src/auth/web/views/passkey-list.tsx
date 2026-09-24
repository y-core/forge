/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { hxAttrs } from "../../../html/htmx/htmx-attrs";
import type { FC } from "../../../jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { EmptyState } from "../../../ui/core/empty-state";
import { Form } from "../../../ui/core/form";
import { cn } from "../../../ui/core/utils/cn";
import { AuthTimestamp } from "./timestamp";
import type { PasskeyListViewProps } from "./types";

const UNNAMED_CREDENTIAL = "Unnamed passkey";

const LOCKOUT_ID = "passkey-lockout";

const LOCKOUT_REASON = "It is your only passkey and no other factor is enrolled, so removing it leaves nothing to sign in with.";

// Design Read: a signed-in visitor keeping their passkeys in order; the one action is adding another;
// failure is removing the last credential with nothing else enrolled — a `warning` Alert in that row.
/** The visitor's registered passkeys, each with its rename and remove affordances. @public */
export const PasskeyListView: FC<PasskeyListViewProps> = ({
  rows,
  fallbackFactors,
  paths,
  enrolPath,
  csrfHeader,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const lockout = rows.length === 1 && fallbackFactors.length === 0;
  const Heading = `h${level ?? 1}` as "h1";

  return (
    <Card class={cn("mx-auto w-full max-w-2xl", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Your passkeys</Heading>
        </Card.Title>
        <Card.Description>Each passkey signs you in from the device it was created on.</Card.Description>
        <Card.Action>
          <Button asChild size='sm'>
            <a href={enrolPath} data-ref='passkey-enrol'>
              Add a passkey
            </a>
          </Button>
        </Card.Action>
      </Card.Header>
      <Card.Content>
        {rows.length === 0 ? (
          <EmptyState>
            <EmptyState.Title level={2}>No passkeys yet</EmptyState.Title>
            <EmptyState.Description>A passkey signs you in with the screen lock you already use on this device.</EmptyState.Description>
            <EmptyState.Actions>
              <Button asChild tone='neutral' appearance='outline'>
                <a href={enrolPath} data-ref='passkey-enrol-empty'>
                  Add your first passkey
                </a>
              </Button>
            </EmptyState.Actions>
          </EmptyState>
        ) : (
          <ul data-ref='credential-list' class='flex flex-col gap-6'>
            {rows.map(({ credential, csrfToken }) => (
              <li key={credential.id} data-ref='credential' class='flex flex-col gap-2'>
                <span data-ref='credential-label' class='text-sm font-medium text-foreground'>
                  {credential.label ?? UNNAMED_CREDENTIAL}
                </span>
                <span data-ref='credential-created' class='text-sm text-muted-foreground'>
                  Added <AuthTimestamp at={credential.createdAt} />
                </span>
                <span data-ref='credential-used' class='text-sm text-muted-foreground'>
                  {credential.lastUsedAt === null ? (
                    "Never used"
                  ) : (
                    <>
                      Last used <AuthTimestamp at={credential.lastUsedAt} />
                    </>
                  )}
                </span>
                {lockout ? (
                  <Alert id={LOCKOUT_ID} tone='warning' data-ref='credential-lockout'>
                    <AppIcon name='alert' class='size-4' />
                    <Alert.Title>Removing this passkey locks you out</Alert.Title>
                    <Alert.Description>{LOCKOUT_REASON}</Alert.Description>
                  </Alert>
                ) : null}
                <div class='flex items-center gap-2'>
                  <Button asChild tone='neutral' appearance='outline' size='sm'>
                    <a href={paths.passkeyEdit({ id: credential.id })} data-ref='credential-rename'>
                      Rename
                    </a>
                  </Button>
                  <Form csrfToken={csrfToken} csrfHeader={csrfHeader} {...hxAttrs({ delete: paths.passkeyRemove({ id: credential.id }) })}>
                    <Button
                      type='submit'
                      tone='destructive'
                      appearance='outline'
                      size='sm'
                      data-ref='credential-remove'
                      aria-describedby={lockout ? LOCKOUT_ID : undefined}>
                      Remove
                    </Button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card.Content>
    </Card>
  );
};
