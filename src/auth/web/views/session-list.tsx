/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import type { FC } from "../../../render/jsx/types";
import { Badge } from "../../../ui/core/badge";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { Form } from "../../../ui/core/form";
import { cn } from "../../../ui/core/utils/cn";
import { FACTOR_LABEL } from "./factors";
import { AuthTimestamp } from "./timestamp";
import type { SessionListViewProps } from "./types";

/** The id on the session list's root. @public */
export const AUTH_SESSION_LIST_ID = "auth-session-list";

const UNKNOWN_DEVICE = "Unknown device";

// Design Read: a signed-in visitor checking where the account is open; the one action is ending a
// session they do not recognise, or all of them but this one; failure is a session already gone — a 404.
/** Every live session on the account, the current one marked, each other one with its own sign-out. @public */
export const SessionListView: FC<SessionListViewProps> = ({
  rows,
  currentId,
  revokePath,
  revokeToken,
  revokeOthersPath,
  revokeOthersToken,
  csrfHeader,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  const others = rows.some((row) => row.id !== currentId);

  return (
    <Card id={AUTH_SESSION_LIST_ID} class={cn("mx-auto w-full max-w-2xl", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Your sessions</Heading>
        </Card.Title>
        <Card.Description>Each browser signed in to this account. Sign out any you do not recognise.</Card.Description>
        {others ? (
          <Card.Action>
            <Form action={revokeOthersPath} csrfToken={revokeOthersToken} csrfHeader={csrfHeader} data-ref='sessions-revoke-others'>
              <Button type='submit' tone='destructive' appearance='outline' size='sm'>
                Sign out everywhere else
              </Button>
            </Form>
          </Card.Action>
        ) : null}
      </Card.Header>
      <Card.Content>
        <ul data-ref='session-list' class='flex flex-col gap-6'>
          {rows.map((row) => (
            <li key={row.id} data-ref='session' class='flex flex-col gap-2'>
              <span class='flex items-center gap-2'>
                <span data-ref='session-device' class='text-sm font-medium text-foreground'>
                  {row.device ?? UNKNOWN_DEVICE}
                </span>
                {row.id === currentId ? (
                  <Badge tone='info' data-ref='session-current'>
                    This device
                  </Badge>
                ) : null}
              </span>
              <span data-ref='session-signed-in' class='text-sm text-muted-foreground'>
                Signed in <AuthTimestamp at={row.signedInAt} />
              </span>
              <span data-ref='session-seen' class='text-sm text-muted-foreground'>
                Last active <AuthTimestamp at={row.lastSeenAt} />
              </span>
              {row.stepUpKind === null ? null : (
                <span data-ref='session-step-up' class='text-sm text-muted-foreground'>
                  Verified with {FACTOR_LABEL[row.stepUpKind]}
                </span>
              )}
              {row.id === currentId ? null : (
                <Form action={revokePath} csrfToken={revokeToken} csrfHeader={csrfHeader} data-ref='session-revoke'>
                  <input type='hidden' name='session' value={row.id} />
                  <Button type='submit' tone='destructive' appearance='outline' size='sm' class='self-start'>
                    Sign out
                  </Button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      </Card.Content>
    </Card>
  );
};
