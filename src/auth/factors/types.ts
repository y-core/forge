import type { Result } from "../../result/types";
import type { AuthKeyRing } from "../types";
import type { AuthNotifier } from "../types";
import type { NonceStore } from "../types";
import type { OtpStateStore } from "../types";
import type { AuthAlgorithm } from "../types";
import type { ChallengeStore } from "../types";
import type { CredentialStore } from "../types";
import type { FactorStore } from "../types";
import type { UserStore } from "../types";
import type { AuthFactor } from "../types";
import type { AuthFactorKind } from "../types";
import type { AuthStoreResult } from "../types";

/** The parts of a factor contract every factor has, whatever its enrolment story. @public */
interface FactorServiceBase {
  readonly kind: AuthFactorKind;
  readonly capabilities: AuthFactorCapabilities;
  // The one place the lifetime lives, so a flow reporting an expiry before it has a challenge to
  // read cannot report a number the factor does not enforce. An upper bound where a factor's
  // challenge ends on a clock of its own — a TOTP step ends where the step ends.
  /** How long a challenge this factor issues lasts, in milliseconds. */
  readonly challengeTtlMs: number;
  // For the same reason the lifetime is here: a page presenting this factor must not be able to ask
  // for a width the factor will refuse, and the width is the factor's own configuration.
  /** How many digits the code this factor asks for has, or `null` for a factor answered by a ceremony. */
  readonly codeDigits: number | null;
  // Same reason as the width, and unreachable from the registry until now: an enrolment page telling
  // a visitor "every 30 seconds" was stating a number only the `otpauth://` URI actually carried.
  /** How long one code stays current, in seconds, or `null` for a factor whose code is not on a clock. */
  readonly codePeriodSeconds: number | null;
  readonly reissueAfterMs: number | null;
  createChallenge(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>>;
  verifyChallenge(userId: string, presented: string, at: number): Promise<Result<AuthFactorVerified, AuthFactorReason>>;
  listEnrolments(userId: string): Promise<AuthStoreResult<readonly AuthFactor[]>>;
}

/** @public */
export interface EmailOtpOptions {
  keys: AuthKeyRing;
  state: OtpStateStore;
  nonces: NonceStore;
  notifier: AuthNotifier;
  /** The address a code is sent to, given the identity it is issued for. */
  address: (userId: string) => string | Promise<string>;
  digits?: number;
  ttlMs?: number;
  maxAttempts?: number;
  cooldownMs?: number;
}

/** Whether this deployment offers the passkey as the factor that identifies, or as the one that steps up. @public */
export type PasskeyFactorRole = "primary" | "step-up";

/** How a user is shown in the authenticator's own account picker. @public */
export interface PasskeyFactorSubject {
  readonly name: string;
  readonly displayName: string;
}

/** @public */
export interface PasskeyFactorOptions {
  rpId: string;
  rpName: string;
  origin: string;
  sessionId: string;
  role: PasskeyFactorRole;
  users: UserStore;
  factors: FactorStore;
  credentials: CredentialStore;
  challenges: ChallengeStore;
  /** How the user is shown in the authenticator's own account picker. */
  subject: (userId: string) => PasskeyFactorSubject | Promise<PasskeyFactorSubject>;
  algorithms?: readonly AuthAlgorithm[];
  ttlSeconds?: number;
}

/** What a factor may be used for. Enrolment is not here — it is the service's own discriminant. @public */
export interface AuthFactorCapabilities {
  readonly primary: boolean;
  readonly stepUp: boolean;
}

/** What a factor challenge hands back to the caller that must present it. @public */
export interface AuthFactorChallenge {
  readonly kind: AuthFactorKind;
  readonly expiresAt: number;
  readonly options?: Readonly<Record<string, unknown>>;
}

/** What a passing verification establishes. @public */
export interface AuthFactorVerified {
  readonly kind: AuthFactorKind;
  readonly userId: string;
  readonly verifiedAt: number;
}

/** Why a factor refused. Uniform at the surface — never echoed to a client. @public */
export type AuthFactorReason =
  | "expired"
  | "consumed"
  | "already-enrolled"
  | "not-enrolled"
  | "too-many-attempts"
  | "too-soon"
  | "unrecognised"
  | "unavailable";

/** A factor whose enrolment is a side effect of something else — a verified email is the enrolment. @public */
export interface ImplicitFactorService extends FactorServiceBase {
  readonly enrolment: "implicit";
}

/** A factor a user enrols in deliberately, through a ceremony of its own. @public */
export interface EnrollableFactorService extends FactorServiceBase {
  readonly enrolment: "explicit";
  beginEnrolment(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>>;
  completeEnrolment(userId: string, presented: string, at: number): Promise<Result<AuthFactor, AuthFactorReason>>;
}

// `enrolment` sits on the service and not on `capabilities` because TypeScript narrows a union only
// on a *direct* discriminant — a nested one leaves it unnarrowed, which is what gets papered over.
/** One factor's whole contract. Test `service.enrolment` to reach the enrolment ceremony. @public */
export type AuthFactorService = EnrollableFactorService | ImplicitFactorService;

/** How many factors a sign-in needs, and when the second one is demanded. @public */
export type AuthFactorPolicy =
  | { readonly mode: "single" }
  | { readonly mode: "second-factor"; readonly required: "always" }
  | { readonly mode: "second-factor"; readonly required: "when-enrolled" }
  | { readonly mode: "second-factor"; readonly required: "for-roles"; readonly roles: readonly string[] };

/** @public */
export interface AuthFactorsOptions {
  readonly offered: readonly AuthFactorService[];
  readonly primary?: AuthFactorKind;
  readonly policy: AuthFactorPolicy;
}

/** What the user's own request knows that the policy does not. @public */
export interface AuthFactorContext {
  readonly roles?: readonly string[];
}

/** What a second factor demands of this sign-in. `enrolment-required` is an outcome, not a failure. @public */
export type AuthFactorResolution =
  | { readonly status: "satisfied" }
  | { readonly status: "step-up-required"; readonly kinds: readonly AuthFactorKind[] }
  | { readonly status: "enrolment-required"; readonly kinds: readonly AuthFactorKind[] };

/** @public */
export interface AuthFactorRegistry {
  readonly primary: AuthFactorService;
  readonly offered: readonly AuthFactorService[];
  readonly policy: AuthFactorPolicy;
  /** The kinds that can satisfy a step-up, in offered order — empty when nothing here can re-authenticate. */
  readonly stepUp: readonly AuthFactorKind[];
  find(kind: AuthFactorKind): AuthFactorService | undefined;
  resolve(userId: string, context?: AuthFactorContext): Promise<AuthStoreResult<AuthFactorResolution>>;
}

/** @public */
export interface TotpAppFactorOptions {
  keys: AuthKeyRing;
  factors: FactorStore;
  issuer: string;
  /** The account label a provisioning URI shows for the identity it enrols. */
  account: (userId: string) => string | Promise<string>;
  digits?: number;
  period?: number;
  secretBytes?: number;
  /** Wrong codes this enrolment admits before it refuses every one, until an accepted code or `lockoutMs` clears them. */
  maxAttempts?: number;
  /** How long a spent budget stays refused before a new guess reopens it. Defaults to `AUTH_TOTP_LOCKOUT_MS`. */
  lockoutMs?: number;
}

/** What an enrolment shows once and never again — the base32 secret and the `otpauth://` URI carrying it. @public */
export type TotpAppEnrolment = { readonly secret: string; readonly uri: string };
