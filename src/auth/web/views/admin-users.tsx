/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../../jsx/types";
import { Badge } from "../../../ui/core/badge";
import { Button } from "../../../ui/core/button";
import { EmptyState } from "../../../ui/core/empty-state";
import { FormField } from "../../../ui/core/field-layout";
import { Form } from "../../../ui/core/form";
import { Input } from "../../../ui/core/input";
import { Link } from "../../../ui/core/link";
import { Pagination } from "../../../ui/core/pagination";
import { Table } from "../../../ui/core/table";
import { cn } from "../../../ui/core/utils/cn";
import { AuthTimestamp } from "./timestamp";
import type { AdminUsersViewProps } from "./types";

// Design Read: an administrator finding one account among many; the one action is searching by
// address; failure is a search matching nothing — an empty state offering the way back to the list.
/** The administrative user listing, with its search form and its forward cursor. @public */
export const AdminUsersView: FC<AdminUsersViewProps> = ({ users, query, nextCursor, paths, icon: AppIcon, class: cls, level }) => {
  const Heading = `h${level ?? 1}` as "h1";
  const listPath = paths.users.list();
  const nextPath = nextCursor === null ? null : paths.users.list({}, query === "" ? { after: nextCursor } : { q: query, after: nextCursor });

  return (
    <div class={cn("mx-auto flex w-full max-w-4xl flex-col gap-6", cls)}>
      <Heading class='text-xl font-semibold text-foreground'>Users</Heading>
      <Form method='get' action={listPath} class='flex items-end gap-2' data-ref='admin-user-search'>
        <FormField name='q' class='max-w-sm flex-1'>
          <FormField.Label name='q'>Search by email address</FormField.Label>
          <Input type='search' value={query} field={{ name: "q" }} />
        </FormField>
        <Button type='submit'>Search</Button>
      </Form>
      {users.length === 0 ? (
        <EmptyState>
          <EmptyState.Title level={2}>{query === "" ? "No accounts yet" : "No account matches that search"}</EmptyState.Title>
          <EmptyState.Description>
            {query === "" ? "An account appears here the first time someone signs up." : "Search matches a whole address or the start of one."}
          </EmptyState.Description>
          <EmptyState.Actions>
            <Button asChild tone='neutral' appearance='outline'>
              <a href={listPath} data-ref='admin-user-clear'>
                Show every account
              </a>
            </Button>
          </EmptyState.Actions>
        </EmptyState>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.Head>Email address</Table.Head>
              <Table.Head>Role</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head>Email verified</Table.Head>
              <Table.Head>Created</Table.Head>
              <Table.Head>
                <span class='sr-only'>Manage</span>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {users.map((user) => (
              <Table.Row key={user.id} data-ref='admin-user-row'>
                <Table.Cell data-ref='admin-user-email'>{user.email}</Table.Cell>
                <Table.Cell>
                  <Badge tone={user.isAdmin ? "info" : "neutral"} data-ref='admin-user-role'>
                    {user.isAdmin ? "Admin" : "Member"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Badge tone={user.deactivatedAt === null ? "success" : "warning"} data-ref='admin-user-status'>
                    {user.deactivatedAt === null ? "Active" : "Deactivated"}
                  </Badge>
                </Table.Cell>
                {/* Only the unverified address earns colour: it is the exception being scanned for. */}
                <Table.Cell>
                  {user.emailVerifiedAt === null ? (
                    <Badge tone='warning' data-ref='admin-user-verified'>
                      Unverified
                    </Badge>
                  ) : (
                    <AuthTimestamp at={user.emailVerifiedAt} data-ref='admin-user-verified' />
                  )}
                </Table.Cell>
                <Table.Cell>
                  <AuthTimestamp at={user.createdAt} />
                </Table.Cell>
                <Table.Cell>
                  <Link href={paths.users.edit({ id: user.id })} decoration='hover' data-ref='admin-user-manage'>
                    Manage
                  </Link>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
      {nextPath === null ? null : (
        <Pagination label='User pages' class='self-end'>
          <Pagination.Next icon={AppIcon} label='Next page' href={nextPath} data-ref='admin-user-next' />
        </Pagination>
      )}
    </div>
  );
};
