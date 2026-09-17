import type { Result } from "../../result/types";
import type { AUTH_IDENTIFYING_FACTORS } from "../config";
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
interface FactorServiceBase<kind extends AuthFactorKind = AuthFactorKind> {
  readonly kind: kind;
  readonly capabilities: AuthFactorCapabilities;
  // On the contract so that a caller reporting an expiry, a width or a period cannot state a number
  // the factor does not enforce.
  /** How long a challenge this factor issues lasts, in milliseconds. */
  readonly challengeTtlMs: number;
  /** How many digits the code this factor asks for has, or `null` for a factor answered by a ceremony. */
  readonly codeDigits: number | null;
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
export interface ImplicitFactorService<kind extends AuthFactorKind = AuthFactorKind> extends FactorServiceBase<kind> {
  readonly enrolment: "implicit";
}

/** A factor a user enrols in deliberately, through a ceremony of its own. @public */
export interface EnrollableFactorService<kind extends AuthFactorKind = AuthFactorKind> extends FactorServiceBase<kind> {
  readonly enrolment: "explicit";
  beginEnrolment(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>>;
  completeEnrolment(userId: string, presented: string, at: number): Promise<Result<AuthFactor, AuthFactorReason>>;
}

/** One factor's whole contract. Test `service.enrolment` to reach the enrolment ceremony. @public */
export type AuthFactorService<kind extends AuthFactorKind = AuthFactorKind> = EnrollableFactorService<kind> | ImplicitFactorService<kind>;

/** A factor kind that identifies the visitor, and so may be offered as primary. @public */
export type AuthIdentifyingFactorKind = (typeof AUTH_IDENTIFYING_FACTORS)[number];

/** A factor service that can start a sign-in, because its kind identifies the visitor. @public */
export type AuthIdentifyingFactorService = AuthFactorService<AuthIdentifyingFactorKind>;

/** What this deployment demands of one second factor. @public */
export type AuthFactorRequirement = "optional" | "mandatory" | { readonly mandatoryForRoles: readonly string[] };

/** One factor as this deployment offers it. Only a factor that identifies the visitor may be primary. @public */
export type AuthFactorOffer =
  | { readonly service: AuthIdentifyingFactorService; readonly role: "primary" }
  | { readonly service: AuthFactorService; readonly role: "second"; readonly requirement: AuthFactorRequirement };

/** @public */
export interface AuthFactorsOptions {
  readonly offered: readonly AuthFactorOffer[];
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
  readonly primary: AuthIdentifyingFactorService;
  readonly offered: readonly AuthFactorService[];
  /** The second factors this deployment offers, in declared order — empty when nothing here can re-authenticate. */
  readonly seconds: readonly Extract<AuthFactorOffer, { role: "second" }>[];
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

/** What the constant-time primitive answered, in the order a factor asked it. @internal */
export type TimingProbe = { compared: boolean[] };

/** A probe and the restore that must run before another suite reads `crypto.subtle`. @internal */
export type TimingProbeHandle = { probe: TimingProbe; restore: () => void };
