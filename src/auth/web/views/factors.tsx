/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { hxAttrs } from "../../../render/htmx/htmx-attrs";
import type { FC } from "../../../render/jsx/types";
import { Alert } from "../../../ui/core/alert";
import { Badge } from "../../../ui/core/badge";
import { Button } from "../../../ui/core/button";
import { EmptyState } from "../../../ui/core/empty-state";
import { Form } from "../../../ui/core/form";
import { Link } from "../../../ui/core/link";
import { Separator } from "../../../ui/core/separator";
import { cn } from "../../../ui/core/utils/cn";
import type { AuthFactorKind } from "../../types";
import { nestedHeadingLevel } from "./heading";
import { AuthTimestamp } from "./timestamp";
import type { AuthFactorRow, AuthFactorsTriggerProps, AuthFactorsViewProps } from "./types";

/** What each factor is called on a page, so no surface spells a stored `kind` at a reader. @internal */
export const FACTOR_LABEL: Readonly<Record<AuthFactorKind, string>> = {
  "email-otp": "Emailed code",
  passkey: "Passkey",
  "recovery-code": "Recovery codes",
  "totp-app": "Authenticator app",
};

/** What each factor does, in the one line a reader needs to tell them apart. */
const FACTOR_NOTE: Readonly<Record<AuthFactorKind, string>> = {
  "email-otp": "How you sign in: a single-use code sent to the address on this account.",
  passkey: "A second factor: the screen lock or security key held by a registered device.",
  "recovery-code": "Single-use codes. Each code works once, in place of a second factor you can't reach.",
  "totp-app": "A second factor: a rotating code from an authenticator app.",
};

const UNNAMED_CREDENTIAL = "Unnamed passkey";

const HEADING_ID = "auth-factors-heading";

const RESET_NOTE =
  "Remove every second factor and recovery code on this account, and sign it out everywhere. The holder then signs in with an emailed code and adds any mandatory second factor before reaching anything else.";

const RESET_CONFIRM = "Remove every second factor and recovery code on this account? This cannot be undone.";

/** The badge each enrolment state earns — a tone, and the word beside it, never the tone alone. */
const STATE_BADGE: Readonly<Record<AuthFactorRow["state"], { readonly tone: "success" | "warning" | "neutral"; readonly label: string }>> = {
  always: { tone: "success", label: "Always available" },
  enrolled: { tone: "success", label: "Enrolled" },
  pending: { tone: "warning", label: "Unconfirmed" },
  none: { tone: "neutral", label: "Not enrolled" },
};

// A link and not a `type='button'`: htmx swaps the panel in place where it is running, and where it
// is not the same href is a page of its own.
/** The control that fetches the panel, replacing itself with what comes back. @public */
export const AuthFactorsTrigger: FC<AuthFactorsTriggerProps> = ({ loadPath, label, class: cls }) => (
  <Button asChild tone='neutral' appearance='outline' size='sm' class={cn("self-start", cls)}>
    <a href={loadPath} data-ref='factors-trigger' {...hxAttrs({ get: loadPath, swap: "outerHTML" })}>
      {label ?? "Show factors"}
    </a>
  </Button>
);

/** Where the account holder manages one factor, or `undefined` for a factor with no page and for an administrator. */
function factorManagePath(kind: AuthFactorKind, manage: AuthFactorsViewProps["manage"]): string | undefined {
  if (manage === undefined) return undefined;
  if (kind === "passkey") return manage.passkeys();
  if (kind === "totp-app") return manage.totp();
  if (kind === "recovery-code") return manage.recoveryCodes();
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

// Design Read: the account's holder or an administrator, checking which factors it holds; the one action
// is managing a factor, offered only to the holder; failure is a down store, which the resolver answers.
/** One account's factors and registered passkeys, identical whoever is reading them. @public */
export const AuthFactorsView: FC<AuthFactorsViewProps> = ({
  factors,
  passkeys,
  manage,
  recovered,
  replaceAppPath,
  reset,
  icon: AppIcon,
  class: cls,
  level,
}) => {
  const own = level ?? 1;
  const Heading = `h${own}` as "h1";
  const nested = nestedHeadingLevel(own);
  const Subheading = `h${nested}` as "h2";
  return (
    <section data-ref='factors' aria-labelledby={HEADING_ID} class={cn("mx-auto flex w-full max-w-2xl flex-col gap-6", cls)}>
      <Heading id={HEADING_ID} class='text-lg font-semibold text-foreground'>
        Factors
      </Heading>
      {recovered === undefined ? null : (
        <Alert tone='info' data-ref='factors-recovered'>
          <AppIcon name='key' class='size-4' />
          <Alert.Title>You signed in with a recovery code</Alert.Title>
          <Alert.Description>
            {recovered === 1 ? "You have 1 unused code left." : `You have ${recovered} unused codes left.`}{" "}
            {replaceAppPath === undefined ? (
              "If your authenticator app or passkey no longer works, add a new one below before you remove the old one, then generate a new set of codes."
            ) : (
              <>
                If your authenticator app no longer works,{" "}
                <Link href={replaceAppPath} data-ref='factors-replace-app'>
                  replace it
                </Link>
                . If a passkey no longer works, add a new one below before you remove the old one. Then generate a new set of codes.
              </>
            )}
          </Alert.Description>
        </Alert>
      )}
      <Subheading class='text-sm font-medium text-foreground'>Factors offered</Subheading>
      {factors.length === 0 ? (
        <EmptyState>
          <EmptyState.Title level={nestedHeadingLevel(nested)}>No factors offered</EmptyState.Title>
          <EmptyState.Description>This deployment offers no factor, so nothing can be enrolled here.</EmptyState.Description>
        </EmptyState>
      ) : (
        <ul data-ref='factor-list' class='flex flex-col gap-3'>
          {factors.map((row) => (
            <AuthFactorItem key={row.kind} row={row} manage={factorManagePath(row.kind, manage)} />
          ))}
        </ul>
      )}
      {manage === undefined ? null : (
        <Link href={manage.sessions()} decoration='hover' class='self-start' data-ref='factors-sessions'>
          Sessions
        </Link>
      )}
      <Separator />
      <Subheading class='text-sm font-medium text-foreground'>Registered passkeys</Subheading>
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
      {reset === undefined ? null : (
        <>
          <Separator />
          <Form
            action={reset.path}
            csrfToken={reset.csrfToken}
            csrfHeader={reset.csrfHeader}
            {...hxAttrs({ post: reset.path, confirm: RESET_CONFIRM })}
            class='flex flex-col gap-2'>
            <p class='max-w-prose text-sm text-pretty text-muted-foreground'>{RESET_NOTE}</p>
            <Button type='submit' tone='destructive' class='self-start' data-ref='factors-reset'>
              Reset second factors
            </Button>
          </Form>
        </>
      )}
    </section>
  );
};
