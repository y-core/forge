import type { AppContext } from "../../context/types";
import { CSRF_HEADER_DEFAULT } from "../../form/constants";
import { mintCsrf } from "../../form/csrf";
import { csrfHeaderCtx } from "../../form/csrf-context";
import { safeRedirectPath } from "../../http/redirect-path";
import type { ForgeIcon } from "../../ui/core/icon";
import type { AdminUserService } from "../admin/service";
import type { AuthFactorRegistry } from "../factors/registry";
import type { AuthEmailChangeFlow } from "../flows/email-change";
import type { AuthSigninFlow } from "../flows/signin";
import type { AuthSignupFlow } from "../flows/signup";
import { PASSKEY_CSRF_HEADER_DEFAULT, type PasskeyMode } from "../passkey-contract";
import type { UserVerification } from "../passkey/options";
import type { AdminUserOutcome, AuthAlgorithm, ChallengeStore, CredentialStore, FactorStore, UserStore } from "../types";
import type { AuthAccountPaths, AuthAdminPaths, AuthEntryPaths } from "./paths";
import type { AuthViews } from "./render";
import type { AuthPasskeyContract } from "./views/passkey-enrol";

/** The sprite symbols forge's own auth pages draw from. @public */
export type AuthIconName = "alert" | "chevron-right" | "key" | "mail";

// The discoverable sign-in has no user to name, so it cannot run through `AuthFactorService`, whose
// `createChallenge` takes a `userId`. These are the parts the ceremony builders need instead.
/** What a passkey ceremony is held against on this request; absent when the deployment offers no passkey. @public */
export interface AuthPasskeyCeremonyOptions {
  readonly rpId: string;
  readonly rpName: string;
  readonly origin: string;
  /** The session the challenge is bound to, so a challenge issued to one visitor cannot be answered by another. */
  readonly sessionId: string;
  readonly challenges: ChallengeStore;
  readonly algorithms?: readonly AuthAlgorithm[];
  readonly ttlSeconds?: number;
  // The stronger posture was unreachable: a discoverable sign-in ran at forge's own defaults with no
  // way to raise them, while `createPasskeyFactor` picks its own per role.
  /** What the authenticator is asked for. Defaults to `preferred`, which admits an authenticator that cannot verify a user. */
  readonly userVerification?: UserVerification;
  /** Whether an assertion that did not verify the user is refused. Defaults to `false`, so asking is not requiring. */
  readonly requireUserVerification?: boolean;
}

/** The domain services one auth request runs against, built per request because a ceremony is bound to its session. @public */
export interface AuthRequestServices {
  readonly users: UserStore;
  readonly credentials: CredentialStore;
  readonly factors: AuthFactorRegistry;
  /** The enrolment rows themselves, which the registry keeps private and the account pages must delete. */
  readonly enrolments: FactorStore;
  readonly signin: AuthSigninFlow;
  readonly signup: AuthSignupFlow;
  readonly emailChange: AuthEmailChangeFlow;
  readonly admin: AdminUserService;
  readonly passkey?: AuthPasskeyCeremonyOptions | undefined;
}

/** The three href maps every loader and action reads its targets off, so no path literal is written twice. @public */
export interface AuthWebPaths {
  readonly auth: AuthEntryPaths;
  readonly account: AuthAccountPaths;
  readonly admin: AuthAdminPaths;
}

/** What every loader, action factory and `register*` needs. @public */
export interface AuthWebOptions<Bindings = Record<string, unknown>> {
  /** Builds this request's services; per request because a passkey ceremony is bound to its session. */
  readonly resolveServices: (c: AppContext<Bindings>) => AuthRequestServices | Promise<AuthRequestServices>;
  readonly paths: AuthWebPaths;
  readonly icon: ForgeIcon<AuthIconName>;
  /** Markup a consumer replaces page by page; an entry receives exactly the props forge's own view does. */
  readonly views?: AuthViews | undefined;
  /** Where a settled sign-in lands when the request carried no return-to. Defaults to the passkey page. */
  readonly settledPath?: string | undefined;
  /** Query parameter carrying the return-to path. Defaults to `next`. */
  readonly returnParam?: string | undefined;
  /** The clock every flow call is made against. Defaults to `Date.now`. */
  readonly now?: (() => number) | undefined;
}

/** Refusal copy and kept input one page render carries; the view owns everything else it says. @public */
export interface AuthPageState {
  /** The value the visitor already typed, kept across a refusal. */
  readonly email?: string | undefined;
  /** A refusal about one field, in the web layer's words. */
  readonly fieldError?: string | undefined;
  /** A refusal about the attempt as a whole. */
  readonly error?: string | undefined;
  /** The address a confirmation has just gone out to. */
  readonly sentTo?: string | undefined;
  /** What an administrative write last reported for the account being rendered. */
  readonly outcome?: AdminUserOutcome | undefined;
  readonly status?: number | undefined;
}

/** This request's clock. @internal */
export function authNow<Bindings>(options: AuthWebOptions<Bindings>): number {
  return options.now === undefined ? Date.now() : options.now();
}

/** Where a request with nothing outstanding is sent. @internal */
export function authSettledPath<Bindings>(options: AuthWebOptions<Bindings>): string {
  return options.settledPath ?? options.paths.account.passkeys();
}

/** The same-origin path this request asked to return to, or the settled one. @internal */
export function authReturnPath<Bindings>(c: AppContext<Bindings>, options: AuthWebOptions<Bindings>): string {
  const asked = c.url.searchParams.get(options.returnParam ?? "next");
  return safeRedirectPath(asked, authSettledPath(options));
}

// Omitted when it is the default, so a deployment that renamed nothing renders byte-identical markup.
/** The header a rendered form must send its token on, absent when `csrfProtection` uses the default. @internal */
export function authCsrfHeader<Bindings>(c: AppContext<Bindings>): { csrfHeader?: string } {
  const csrfHeader = csrfHeaderCtx.getOptional(c);
  return csrfHeader === undefined || csrfHeader === CSRF_HEADER_DEFAULT ? {} : { csrfHeader };
}

/** Mints the two path-bound tokens a ceremony needs and packs them with the contract the controller reads. @internal */
export async function authPasskeyContract<Bindings>(
  c: AppContext<Bindings>,
  mode: PasskeyMode,
  optionsPath: string,
  verifyPath: string,
  redirect: string,
): Promise<AuthPasskeyContract> {
  const csrfHeader = csrfHeaderCtx.getOptional(c);
  return {
    mode,
    optionsPath,
    verifyPath,
    optionsToken: await mintCsrf(c, optionsPath),
    verifyToken: await mintCsrf(c, verifyPath),
    redirect,
    // Omitted when it matches the controller's own default, so the attribute stays absent in the common case.
    ...(csrfHeader !== undefined && csrfHeader !== PASSKEY_CSRF_HEADER_DEFAULT ? { csrfHeader } : {}),
  };
}
