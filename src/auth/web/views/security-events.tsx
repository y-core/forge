/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import type { FC } from "../../../render/jsx/types";
import { Card } from "../../../ui/core/card";
import { EmptyState } from "../../../ui/core/empty-state";
import { cn } from "../../../ui/core/utils/cn";
import type { AuthSecurityEventType } from "../../types";
import { FACTOR_LABEL } from "./factors";
import { nestedHeadingLevel } from "./heading";
import { AuthTimestamp } from "./timestamp";
import type { SecurityEventListViewProps } from "./types";

/** The id on the security event list's root. @public */
export const AUTH_SECURITY_EVENT_LIST_ID = "auth-security-event-list";

const EVENT_LABEL: Readonly<Record<AuthSecurityEventType, string>> = {
  "signed-in": "Signed in",
  "stepped-up": "Verified again",
  "sessions-revoked": "Sessions signed out",
  "factor-added": "Factor added",
  "factor-removed": "Factor removed",
  "factor-replaced": "Factor replaced",
  "recovery-codes-issued": "New recovery codes issued",
  "recovery-code-used": "Recovery code used",
  "email-changed": "Email address changed",
  "admin-granted": "Administrator role granted",
  "admin-revoked": "Administrator role removed",
  "factors-reset": "Factors reset",
  "account-deactivated": "Account deactivated",
  "account-reactivated": "Account reactivated",
};

// Design Read: a signed-in visitor checking what has happened to their account; there is no action, only
// reading; failure is an account with no events left — an empty state, not an error.
/** An account's security events, each named with its factor, its time and whether an administrator made it. @public */
export const SecurityEventListView: FC<SecurityEventListViewProps> = ({ rows, class: cls, level }) => {
  const own = level ?? 1;
  const Heading = `h${own}` as "h1";

  return (
    <Card id={AUTH_SECURITY_EVENT_LIST_ID} class={cn("mx-auto w-full max-w-2xl", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl'>Recent activity</Heading>
        </Card.Title>
        <Card.Description>Sign-ins and changes to how this account is secured, newest first.</Card.Description>
      </Card.Header>
      <Card.Content>
        {rows.length === 0 ? (
          <EmptyState>
            <EmptyState.Title level={nestedHeadingLevel(own)}>No activity recorded</EmptyState.Title>
            <EmptyState.Description>Nothing has happened to this account in the time its activity is kept.</EmptyState.Description>
          </EmptyState>
        ) : (
          <ul data-ref='security-event-list' class='flex flex-col gap-4'>
            {rows.map((row) => (
              <li key={row.id} data-ref='security-event' class='flex flex-col gap-1'>
                <span data-ref='security-event-type' class='text-sm font-medium text-foreground'>
                  {EVENT_LABEL[row.type]}
                </span>
                {row.factorKind === null ? null : (
                  <span data-ref='security-event-factor' class='text-sm text-muted-foreground'>
                    {FACTOR_LABEL[row.factorKind]}
                  </span>
                )}
                <span class='text-sm text-muted-foreground'>
                  <AuthTimestamp at={row.at} data-ref='security-event-at' />
                  {row.adminId === null ? null : <span data-ref='security-event-admin'> by an administrator</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card.Content>
    </Card>
  );
};
