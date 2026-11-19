/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { hxAttrs } from "../../../render/htmx/htmx-attrs";
import type { FC } from "../../../render/jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { EmptyState } from "../../../ui/core/empty-state";
import { Form } from "../../../ui/core/form";
import { Link } from "../../../ui/core/link";
import { cn } from "../../../ui/core/utils/cn";
import { nestedHeadingLevel } from "./heading";
import { AuthTimestamp } from "./timestamp";
import type { PasskeyListViewProps } from "./types";

/** The id on the passkey list's root, which each row's remove form swaps the re-rendered list into. @public */
export const AUTH_PASSKEY_LIST_ID = "auth-passkey-list";

const UNNAMED_CREDENTIAL = "Unnamed passkey";

const MANDATORY_ID = "passkey-mandatory";

const MANDATORY_REASON = "Your account requires a passkey. Add another before you remove this one.";

// Design Read: a signed-in visitor keeping their passkeys in order; the one action is adding another;
// failure is removing the only passkey where one is mandatory — the control disabled with its reason, and a refused removal's Alert.
/** The visitor's registered passkeys, each with its rename and remove affordances. @public */
export const PasskeyListView: FC<PasskeyListViewProps> = ({
  rows,
  mandatory,
  paths,
  enrolPath,
  backupPrompt,
  error,
  csrfHeader,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";

  return (
    <Card id={AUTH_PASSKEY_LIST_ID} class={cn("mx-auto w-full max-w-2xl", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Your passkeys</Heading>
        </Card.Title>
        <Card.Description>Each passkey is a second factor that works on the device it was created on.</Card.Description>
        <Card.Action>
          <Button asChild size='sm'>
            <a href={enrolPath} data-ref='passkey-enrol'>
              Add a passkey
            </a>
          </Button>
        </Card.Action>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {error === undefined ? null : (
          <Alert tone='destructive' data-ref='passkey-error'>
            <AppIcon name='alert' class='size-4' />
            <Alert.Title>We could not remove that passkey</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert>
        )}
        {backupPrompt ? (
          <Alert data-ref='passkey-backup'>
            <Alert.Title>Add a backup passkey</Alert.Title>
            <Alert.Description>
              This is your only passkey. If you lose this device, you'll need a recovery code to finish signing in.{" "}
              <Link href={enrolPath} data-ref='passkey-backup-enrol'>
                Add a second passkey on another device or a security key
              </Link>
              .
            </Alert.Description>
          </Alert>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState>
            <EmptyState.Title level={nestedHeadingLevel(level ?? 1)}>No passkeys yet</EmptyState.Title>
            <EmptyState.Description>A passkey is a second factor that checks it's you with this device's screen lock.</EmptyState.Description>
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
                {mandatory ? (
                  <span id={MANDATORY_ID} data-ref='credential-mandatory' class='text-sm text-muted-foreground'>
                    {MANDATORY_REASON}
                  </span>
                ) : null}
                <div class='flex items-center gap-2'>
                  <Button asChild tone='neutral' appearance='outline' size='sm'>
                    <a href={paths.passkeyEdit({ id: credential.id })} data-ref='credential-rename'>
                      Rename
                    </a>
                  </Button>
                  <Form
                    csrfToken={csrfToken}
                    csrfHeader={csrfHeader}
                    {...hxAttrs({ delete: paths.passkeyRemove({ id: credential.id }), target: `#${AUTH_PASSKEY_LIST_ID}`, swap: "outerHTML" })}>
                    <Button
                      type='submit'
                      tone='destructive'
                      appearance='outline'
                      size='sm'
                      data-ref='credential-remove'
                      disabled={mandatory}
                      aria-describedby={mandatory ? MANDATORY_ID : undefined}>
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
