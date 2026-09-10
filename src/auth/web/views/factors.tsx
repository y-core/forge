/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { hxAttrs } from "../../../html/htmx/htmx-attrs";
import type { FC } from "../../../jsx/types";
import { Badge } from "../../../ui/core/badge";
import { Button } from "../../../ui/core/button";
import { EmptyState } from "../../../ui/core/empty-state";
import { Link } from "../../../ui/core/link";
import { Separator } from "../../../ui/core/separator";
import { cn } from "../../../ui/core/utils/cn";
import type { AuthFactorKind } from "../../types";
import { AuthTimestamp } from "./timestamp";
import type { AuthFactorRow, AuthFactorsTriggerProps, AuthFactorsViewProps } from "./types";

/** What each factor is called on a page, so no surface spells a stored `kind` at a reader. */
const FACTOR_LABEL: Readonly<Record<AuthFactorKind, string>> = { "email-otp": "Emailed code", passkey: "Passkey", "totp-app": "Authenticator app" };

/** What each factor does, in the one line a reader needs to tell them apart. */
const FACTOR_NOTE: Readonly<Record<AuthFactorKind, string>> = {
  "email-otp": "A single-use code sent to the address on this account.",
  passkey: "The screen lock or security key held by a registered device.",
  "totp-app": "A rotating code from an authenticator app.",
};

const UNNAMED_CREDENTIAL = "Unnamed passkey";

/** The badge each enrolment state earns — a tone, and the word beside it, never the tone alone. */
const STATE_BADGE: Readonly<Record<AuthFactorRow["state"], { readonly tone: "success" | "warning" | "neutral"; readonly label: string }>> = {
  always: { tone: "success", label: "Always available" },
  enrolled: { tone: "success", label: "Enrolled" },
  pending: { tone: "warning", label: "Unconfirmed" },
  none: { tone: "neutral", label: "Not enrolled" },
};

// A link and not a `type='button'`: htmx swaps the panel in place where it is running, and where it
// is not the same href is a page of its own, because the route renders a whole document off a
// request carrying no `HX-Request`.
/** The control that fetches the panel, replacing itself with what comes back. @public */
export const AuthFactorsTrigger: FC<AuthFactorsTriggerProps> = ({ loadPath, label, class: cls }) => (
  <Button asChild tone='neutral' appearance='outline' size='sm' class={cn("self-start", cls)}>
    <a href={loadPath} data-ref='factors-trigger' {...hxAttrs({ get: loadPath, swap: "outerHTML" })}>
      {label ?? "Show sign-in methods"}
    </a>
  </Button>
);

/** Where the account holder manages one factor, or `undefined` for a factor with no page and for an administrator. */
function factorManagePath(kind: AuthFactorKind, manage: AuthFactorsViewProps["manage"]): string | undefined {
  if (manage === undefined) return undefined;
  if (kind === "passkey") return manage.passkeys();
  if (kind === "totp-app") return manage.totp();
  return undefined;
}

/** One factor's row: what it is, whether it is enrolled, and when that happened. */
const AuthFactorItem: FC<{ row: AuthFactorRow; manage: string | undefined }> = ({ row, manage }) => {
  const badge = STATE_BADGE[row.state];
  return (
    <li data-ref='factor' class='flex flex-col gap-1'>
      <span class='flex items-center gap-2'>
        <span data-ref='factor-name' class='text-sm font-medium text-foreground'>
          {FACTOR_LABEL[row.kind]}
        </span>
        <Badge tone={badge.tone} data-ref='factor-state'>
          {badge.label}
        </Badge>
      </span>
      <span class='max-w-prose text-sm text-pretty text-muted-foreground'>{FACTOR_NOTE[row.kind]}</span>
      {row.at === null ? null : (
        <span data-ref='factor-at' class='text-sm text-muted-foreground'>
          {row.state === "pending" ? "Started " : "Enrolled "}
          <AuthTimestamp at={row.at} />
        </span>
      )}
      {manage === undefined ? null : (
        <Link href={manage} decoration='hover' data-ref='factor-manage'>
          Manage
        </Link>
      )}
    </li>
  );
};

// Design Read: whoever may read this account — its holder, or an administrator looking at it —
// checking what can sign it in; the one action is managing a factor, which only the holder is
// offered; failure is a store that is down, which the resolver answers with rather than this view.
/** One account's sign-in methods and registered passkeys, identical whoever is reading them. @public */
export const AuthFactorsView: FC<AuthFactorsViewProps> = ({ factors, passkeys, manage, icon: AppIcon, class: cls, level }) => {
  const own = level ?? 2;
  const Heading = `h${own}` as "h2";
  const nested = (own < 6 ? own + 1 : 6) as 3;
  return (
    <section data-ref='factors' class={cn("flex flex-col gap-6", cls)}>
      <Heading class='text-sm font-medium text-foreground'>Sign-in methods</Heading>
      {factors.length === 0 ? (
        <EmptyState>
          <EmptyState.Title level={nested}>No sign-in methods offered</EmptyState.Title>
          <EmptyState.Description>This deployment offers no factor, so nothing can be enrolled here.</EmptyState.Description>
        </EmptyState>
      ) : (
        <ul data-ref='factor-list' class='flex flex-col gap-3'>
          {factors.map((row) => (
            <AuthFactorItem key={row.kind} row={row} manage={factorManagePath(row.kind, manage)} />
          ))}
        </ul>
      )}
      <Separator />
      <Heading class='text-sm font-medium text-foreground'>Registered passkeys</Heading>
      {passkeys.length === 0 ? (
        <p data-ref='passkey-none' class='max-w-prose text-sm text-pretty text-muted-foreground'>
          <AppIcon name='key' class='me-2 inline-block size-4' />
          No passkey is registered on this account.
        </p>
      ) : (
        <ul data-ref='passkey-list' class='flex flex-col gap-3'>
          {passkeys.map((credential) => (
            <li key={credential.id} data-ref='passkey' class='flex flex-col gap-1'>
              <span data-ref='passkey-label' class='text-sm font-medium text-foreground'>
                {credential.label ?? UNNAMED_CREDENTIAL}
              </span>
              <span data-ref='passkey-used' class='text-sm text-muted-foreground'>
                {credential.lastUsedAt === null ? (
                  "Never used"
                ) : (
                  <>
                    Last used <AuthTimestamp at={credential.lastUsedAt} />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
