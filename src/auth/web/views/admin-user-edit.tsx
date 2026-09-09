/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { hxAttrs } from "../../../html/htmx/htmx-attrs";
import type { FC } from "../../../jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Badge } from "../../../ui/core/badge";
import { Button } from "../../../ui/core/button";
import { Card } from "../../../ui/core/card";
import { Form } from "../../../ui/core/form";
import type { ForgeIcon } from "../../../ui/core/icon";
import { Separator } from "../../../ui/core/separator";
import { cn } from "../../../ui/core/utils/cn";
import { isLastAdminRefusal } from "../../admin/service";
import type { AdminUserOutcome, AuthUser } from "../../types";
import type { AuthAdminPaths } from "../paths";
import { AuthTimestamp } from "./timestamp";
import type { AuthViewChrome } from "./types";

const DEMOTE_REASON = "This is the last admin who can still sign in — promote another admin before removing this role.";

const DEACTIVATE_REASON = "This is the last admin who can still sign in — promote another admin before deactivating this account.";

const DELETE_REASON = "This is the last admin who can still sign in — promote another admin before deleting this account.";

const NOT_FOUND_REASON = "That account no longer exists, so nothing was changed.";

const DEMOTE_REASON_ID = "admin-role-reason";

const DEACTIVATE_REASON_ID = "admin-status-reason";

const DELETE_REASON_ID = "admin-delete-reason";

const REFUSAL_REASON: Readonly<Partial<Record<AdminUserOutcome, string>>> = {
  "last-admin-demote": DEMOTE_REASON,
  "last-admin-deactivate": DEACTIVATE_REASON,
  "last-admin-delete": DELETE_REASON,
  "not-found": NOT_FOUND_REASON,
};

/** What the administrative account page renders. @public */
export type AdminUserEditViewProps = AuthViewChrome & {
  readonly user: AuthUser;
  /** Whether this account is the last admin who could still sign in, read off `AdminUserStore.countAdmins`. */
  readonly lastAdmin: boolean;
  /** What an administrative write last reported for this account, or `null` on a plain page load. */
  readonly outcome: AdminUserOutcome | null;
  readonly paths: AuthAdminPaths;
  readonly csrfToken: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  readonly icon: ForgeIcon<"alert">;
};

// Design Read: an administrator changing one account's role, status or existence; the one action is
// the role change; failure is the last-admin guard, each guarded control disabled with its reason.
/** One account's role, status and deletion controls, disabled with their reasons where the last-admin guard would refuse. @public */
export const AdminUserEditView: FC<AdminUserEditViewProps> = ({
  user,
  lastAdmin,
  outcome,
  paths,
  csrfToken,
  csrfHeader,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const Heading = `h${level ?? 1}` as "h1";
  const guarded = lastAdmin || (outcome !== null && isLastAdminRefusal(outcome));
  const active = user.deactivatedAt === null;
  const demoteGuarded = guarded && user.isAdmin;
  const deactivateGuarded = guarded && active;
  const refused = outcome === null ? undefined : REFUSAL_REASON[outcome];
  const updatePath = paths.users.update({ id: user.id });

  return (
    <Card class={cn("mx-auto w-full max-w-2xl", cls)}>
      <Card.Header>
        <Card.Title>
          <Heading class='text-xl' data-ref='admin-user-email'>
            {user.email}
          </Heading>
        </Card.Title>
        <Card.Description>
          <span data-ref='admin-user-created'>
            Created <AuthTimestamp at={user.createdAt} />
          </span>
        </Card.Description>
        <Card.Action>
          <Badge tone={user.isAdmin ? "info" : "neutral"} data-ref='admin-user-role'>
            {user.isAdmin ? "Admin" : "Member"}
          </Badge>
        </Card.Action>
      </Card.Header>
      <Card.Content class='flex flex-col gap-6'>
        {refused === undefined ? null : (
          <Alert tone='destructive' data-ref='admin-refusal'>
            <AppIcon name='alert' class='size-4' />
            <Alert.Title>That change was refused</Alert.Title>
            <Alert.Description>{refused}</Alert.Description>
          </Alert>
        )}
        <Form csrfToken={csrfToken} csrfHeader={csrfHeader} {...hxAttrs({ patch: updatePath })} class='flex flex-col gap-2'>
          <input type='hidden' name='role' value={user.isAdmin ? "member" : "admin"} />
          <input type='hidden' name='status' value={active ? "active" : "deactivated"} />
          {demoteGuarded ? (
            <p id={DEMOTE_REASON_ID} data-ref='admin-role-reason' class='text-sm text-muted-foreground'>
              {DEMOTE_REASON}
            </p>
          ) : null}
          <Button
            type='submit'
            class='self-start'
            disabled={demoteGuarded}
            data-ref='admin-role-submit'
            aria-describedby={demoteGuarded ? DEMOTE_REASON_ID : undefined}>
            {user.isAdmin ? "Remove the admin role" : "Grant the admin role"}
          </Button>
        </Form>
        <Separator />
        <Form csrfToken={csrfToken} csrfHeader={csrfHeader} {...hxAttrs({ patch: updatePath })} class='flex flex-col gap-2'>
          <input type='hidden' name='role' value={user.isAdmin ? "admin" : "member"} />
          <input type='hidden' name='status' value={active ? "deactivated" : "active"} />
          {deactivateGuarded ? (
            <p id={DEACTIVATE_REASON_ID} data-ref='admin-status-reason' class='text-sm text-muted-foreground'>
              {DEACTIVATE_REASON}
            </p>
          ) : null}
          <Button
            type='submit'
            tone='neutral'
            appearance='outline'
            class='self-start'
            disabled={deactivateGuarded}
            data-ref='admin-status-submit'
            aria-describedby={deactivateGuarded ? DEACTIVATE_REASON_ID : undefined}>
            {active ? "Deactivate this account" : "Reactivate this account"}
          </Button>
        </Form>
        <Separator />
        <Form
          csrfToken={csrfToken}
          csrfHeader={csrfHeader}
          {...hxAttrs({ delete: paths.users.remove({ id: user.id }) })}
          class='flex flex-col gap-2'>
          {guarded ? (
            <p id={DELETE_REASON_ID} data-ref='admin-delete-reason' class='text-sm text-muted-foreground'>
              {DELETE_REASON}
            </p>
          ) : null}
          <Button
            type='submit'
            tone='destructive'
            class='self-start'
            disabled={guarded}
            data-ref='admin-delete-submit'
            aria-describedby={guarded ? DELETE_REASON_ID : undefined}>
            Delete this account
          </Button>
        </Form>
      </Card.Content>
    </Card>
  );
};
