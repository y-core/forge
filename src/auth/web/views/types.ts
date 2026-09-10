import type { ForgeIcon } from "../../../ui/core/types";
import type { OtpLength } from "../../../ui/core/types";
import type { TotpAppEnrolment } from "../../factors/types";
import type { AdminUserOutcome } from "../../types";
import type { AuthUser } from "../../types";
import type { AuthCredential } from "../../types";
import type { PasskeyMode } from "../../types";
import type { AuthFactorKind } from "../../types";
import type { AuthAdminPaths } from "../types";
import type { AuthAccountPaths } from "../types";
/** What every auth view accepts so a host page can place it. @public */
export interface AuthViewChrome {
  /** Composed onto the root after the view's own classes, so the caller's width or margin wins. */
  readonly class?: string | undefined;
  /** Heading level, from the view's place in the host document. Never from its size. Defaults to `1`. */
  readonly level?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
}

/** What the first-admin elevation page renders. @public */
export type AdminElevateViewProps = AuthViewChrome & {
  /** Admins who could still sign in; the claim is open only while this is zero. */
  readonly adminCount: number;
  readonly paths: AuthAdminPaths;
  readonly csrfToken: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  readonly icon: ForgeIcon<"alert">;
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

/** What the administrative user listing renders. @public */
export type AdminUsersViewProps = AuthViewChrome & {
  readonly users: readonly AuthUser[];
  /** The search term this page was read with; empty when the listing is unfiltered. */
  readonly query: string;
  /** The id the next page starts after, or `null` when this page is the last one. */
  readonly nextCursor: string | null;
  readonly paths: AuthAdminPaths;
  readonly icon: ForgeIcon<"chevron-right">;
};

/** What the email-change page renders. @public */
export type EmailChangeViewProps = AuthViewChrome & {
  /** The address in force now, so the visitor can see what they are replacing. */
  readonly currentEmail: string;
  readonly submitPath: string;
  readonly accountPath: string;
  readonly csrfToken: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  /** The new address the visitor already typed, kept across a refusal. */
  readonly email?: string | undefined;
  readonly fieldError?: string | undefined;
  /** A refusal about the attempt as a whole. */
  readonly error?: string | undefined;
  /** Set once the confirmation has gone out, so the page reports the outcome rather than repeating the form. */
  readonly sentTo?: string | undefined;
  readonly icon: ForgeIcon<"alert" | "mail">;
};

/** What the passkey rename page renders. @public */
export type PasskeyEditViewProps = AuthViewChrome & {
  readonly credential: AuthCredential;
  readonly renamePath: string;
  readonly cancelPath: string;
  readonly csrfToken: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  readonly fieldError?: string | undefined;
  readonly icon: ForgeIcon<"alert">;
};

/** Everything the browser controller reads off the ceremony's scope root. @public */
export type AuthPasskeyContract = {
  readonly mode: PasskeyMode;
  readonly optionsPath: string;
  readonly verifyPath: string;
  /** Minted for `optionsPath` alone — `csrfProtection` binds a token to one path. */
  readonly optionsToken: string;
  /** Minted for `verifyPath` alone, and never the same value as `optionsToken`. */
  readonly verifyToken: string;
  /** The app's own CSRF header name, when it is not `csrfProtection`'s default. */
  readonly csrfHeader?: string | undefined;
  readonly redirect?: string | undefined;
};

/** What the passkey enrolment page renders. @public */
export type PasskeyEnrolViewProps = AuthViewChrome & {
  readonly contract: AuthPasskeyContract;
  /** Where a visitor who cannot enrol now is sent instead. */
  readonly signoutPath: string;
  /** The address the enrolment is being made for, shown so the visitor can tell whose account it is. */
  readonly email: string;
  /** A refusal about the attempt as a whole, in this view's own words. */
  readonly error?: string | undefined;
  readonly icon: ForgeIcon<"alert" | "key">;
};

/** One registered passkey and the token authorising the writes on it. @public */
export type PasskeyRow = { readonly credential: AuthCredential; readonly csrfToken: string };

/** What the passkey management page renders. @public */
export type PasskeyListViewProps = AuthViewChrome & {
  readonly rows: readonly PasskeyRow[];
  /** Factors that would still admit this visitor once every passkey is gone; email-OTP carries no enrolment row, so it cannot be read off `FactorStore`. */
  readonly fallbackFactors: readonly AuthFactorKind[];
  readonly paths: AuthAccountPaths;
  /** Where a passkey is enrolled — an `authRoutes` path, which `accountRoutes` does not carry. */
  readonly enrolPath: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  readonly icon: ForgeIcon<"alert">;
};

/** What the sign-in page renders. @public */
export type SigninViewProps = AuthViewChrome & {
  /** The factor that starts a sign-in. Never `totp-app`, which proves possession but identifies nobody. */
  readonly primaryFactor: AuthFactorKind;
  /** The ceremony contract, present exactly when a passkey can sign this deployment in. */
  readonly passkey?: AuthPasskeyContract | undefined;
  readonly submitPath: string;
  readonly signupPath: string;
  readonly csrfToken: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  /** The address the visitor already typed, so a refusal does not empty the field. */
  readonly email?: string | undefined;
  /** A refusal about the address itself, in this view's own words — `describeValidationIssue` names a field and nothing more. */
  readonly fieldError?: string | undefined;
  /** A refusal about the attempt as a whole: a rate limit, a refused ceremony. */
  readonly error?: string | undefined;
  readonly icon: ForgeIcon<"alert" | "key" | "mail">;
};

/** What the sign-up page renders. @public */
export type SignupViewProps = AuthViewChrome & {
  readonly submitPath: string;
  readonly signinPath: string;
  readonly csrfToken: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  readonly email?: string | undefined;
  readonly fieldError?: string | undefined;
  /** A refusal about the attempt as a whole. */
  readonly error?: string | undefined;
  // Read off the offered factors rather than assumed: a deployment demanding no second factor must
  // not promise a step its visitor will never be shown, and one that switched the passkey off must
  // not name it. Absent means the emailed code is the whole of signing up.
  /** The factor the visitor enrols after confirming the address, absent when none is demanded. */
  readonly enrols?: AuthFactorKind | undefined;
  readonly icon: ForgeIcon<"alert">;
};

/** Which of the authenticator app's two page states is rendering; only the enrolling one carries the secret. @public */
export type TotpEnrolState = ({ readonly status: "enrolling" } & TotpAppEnrolment) | { readonly status: "enrolled"; readonly enrolledAt: number };

/** What the authenticator-app page renders. @public */
export type TotpEnrolViewProps = AuthViewChrome & {
  readonly state: TotpEnrolState;
  /** Where the confirmation code is posted. */
  readonly enrolPath: string;
  // Absent on the page an owed enrolment lands on: there is nothing enrolled there to take away, and
  // a session owing a step-up must not be able to remove the factor that would satisfy it.
  /** Where the settled enrolment is deleted, absent where removal is not offered. */
  readonly removePath?: string | undefined;
  readonly csrfToken: string;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  /** Copy for a rejected confirmation code; the view owns the wording, since `describeValidationIssue` returns only a field name. */
  readonly fieldError?: string | undefined;
  readonly icon: ForgeIcon<"alert">;
};

/** What the verification page renders. @public */
export type VerifyViewProps = AuthViewChrome & {
  /** Which enrolled factor is being presented. A step-up on `passkey` is a ceremony, not a code. */
  readonly factor: AuthFactorKind;
  /** How wide the code field is, read off the factor being presented. Defaults to the six digits forge's own OTP uses. */
  readonly codeDigits?: OtpLength | undefined;
  /** The ceremony contract, required when `factor` is `passkey`. */
  readonly passkey?: AuthPasskeyContract | undefined;
  readonly submitPath: string;
  /** Where a new code is asked for. Only an emailed code can be re-sent. */
  readonly resendPath?: string | undefined;
  readonly signinPath: string;
  readonly csrfToken: string;
  // A token is minted for one path, so the second form on this page cannot borrow the first's.
  /** The token for `resendPath`, required whenever that path is given. */
  readonly resendToken?: string | undefined;
  // Deliberately "a code was asked for", never "a code was sent": only a registered address can be
  // inside the reissue window, so reporting what actually happened would bin an address list.
  /** Whether this render follows a press of the resend control. */
  readonly resent?: boolean | undefined;
  /** The wait the factor enforces between codes, read off the factor rather than named in copy. */
  readonly reissueAfterMs?: number | undefined;
  /** The header `csrfProtection` checks the token on, when the app renamed it. */
  readonly csrfHeader?: string | undefined;
  /** The address the code went to, so the visitor can see they are watching the right inbox. */
  readonly email?: string | undefined;
  /** A refusal about the code itself. */
  readonly fieldError?: string | undefined;
  /** A refusal about the attempt as a whole: too many tries, an expired sign-in. */
  readonly error?: string | undefined;
  readonly icon: ForgeIcon<"alert" | "key" | "mail">;
};
