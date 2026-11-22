import type { KeyRing } from "../../crypto/keyring/types";
import type { Logger } from "../../logging/types";
import type { Result } from "../../result/types";
import type { AUTH_IDENTIFYING_FACTORS, AUTH_SECOND_FACTORS } from "../config";
import type { AuthNotifier } from "../types";
import type { NonceStore } from "../types";
import type { OtpStateStore } from "../types";
import type { AuthAlgorithm } from "../types";
import type { ChallengeStore } from "../types";
import type { CredentialStore } from "../types";
import type { FactorStore } from "../types";
import type { RecoveryCodeStore } from "../types";
import type { UserStore } from "../types";
import type { AuthFactor } from "../types";
import type { AuthFactorKind } from "../types";
import type { AuthStoreResult } from "../types";

/** What the requesting browser contributes to a factor call. @public */
export interface AuthFactorCaller {
  /** The per-browser value an emailed code is bound to; `null` issues nothing and verifies nothing. */
  readonly binding: string | null;
  /** SHA-256 of the acting session's token, spared by the revocation a factor change makes; `null` before sign-in. */
  readonly keep: Uint8Array<ArrayBuffer> | null;
}

/** The parts of a factor contract every factor has, whatever its enrolment story. @public */
interface FactorServiceBase<kind extends AuthFactorKind = AuthFactorKind> {
  readonly kind: kind;
  readonly capabilities: AuthFactorCapabilities;
  // On the contract so that a caller reporting an expiry, a width or a period cannot state a number
  // the factor does not enforce.
  /** How long a challenge this factor issues lasts, in milliseconds. */
  readonly challengeTtlMs: number;
  /** How many digits the code this factor asks for has, or `null` for a factor not answered by a numeric code. */
  readonly codeDigits: number | null;
  /** How long one code stays current, in seconds, or `null` for a factor whose code is not on a clock. */
  readonly codePeriodSeconds: number | null;
  readonly reissueAfterMs: number | null;
  /** The longest a spent attempt budget goes on refusing, in milliseconds; unset where the factor cannot bound it. */
  readonly attemptWindowMs?: number;
  createChallenge(userId: string, at: number, caller: AuthFactorCaller): Promise<Result<AuthFactorChallenge, AuthFactorReason>>;
  verifyChallenge(userId: string, presented: string, at: number, caller: AuthFactorCaller): Promise<Result<AuthFactorVerified, AuthFactorReason>>;
  listEnrolments(userId: string): Promise<AuthStoreResult<readonly AuthFactor[]>>;
}

/** @public */
export interface EmailOtpOptions {
  keys: KeyRing;
  state: OtpStateStore;
  nonces: NonceStore;
  notifier: AuthNotifier;
  /** The address a code is sent to, given the identity it is issued for. */
  address: (userId: string) => AuthStoreResult<string> | Promise<AuthStoreResult<string>>;
  logger?: Logger;
  digits?: number;
  ttlMs?: number;
  maxAttempts?: number;
  guessWindowMs?: number;
  cooldownMs?: number;
}

/** How a user is shown in the authenticator's own account picker. @public */
export interface PasskeyFactorSubject {
  readonly name: string;
  readonly displayName: string;
}

/** The salts a passkey's PRF is evaluated with, so the page can derive a key the server never holds. @public */
export interface PasskeyPrfSalts {
  /** The salt a new credential is first evaluated with, or `null` to request no PRF for this user. */
  registration?: (userId: string) => Uint8Array<ArrayBuffer> | null | Promise<Uint8Array<ArrayBuffer> | null>;
  /** Salts keyed by base64url credential id; an id left out is asked for no PRF output. */
  stepUp?: (
    userId: string,
    credentialIds: readonly string[],
  ) => ReadonlyMap<string, Uint8Array<ArrayBuffer>> | Promise<ReadonlyMap<string, Uint8Array<ArrayBuffer>>>;
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
  prf?: PasskeyPrfSalts;
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
  | "unavailable"
  /** The enrolment stands, but the key its secret needs is missing or no longer opens it. */
  | "unusable";

/** An opened TOTP secret, with `stale` set where the key that sealed it is no longer the ring's active one. @internal */
export interface TotpSecretOpened {
  readonly secret: Uint8Array<ArrayBuffer>;
  readonly stale: boolean;
}

/** A factor whose enrolment is a side effect of something else — a verified email is the enrolment. @public */
export interface ImplicitFactorService<kind extends AuthFactorKind = AuthFactorKind> extends FactorServiceBase<kind> {
  readonly enrolment: "implicit";
}

/** A factor a user enrols in deliberately, through a ceremony of its own. @public */
export interface EnrollableFactorService<kind extends AuthFactorKind = AuthFactorKind> extends FactorServiceBase<kind> {
  readonly enrolment: "explicit";
  beginEnrolment(userId: string, at: number): Promise<Result<AuthFactorChallenge, AuthFactorReason>>;
  completeEnrolment(userId: string, presented: string, at: number, caller: AuthFactorCaller): Promise<Result<AuthFactor, AuthFactorReason>>;
}

/** One factor's whole contract. Test `service.enrolment` to reach the enrolment ceremony. @public */
export type AuthFactorService<kind extends AuthFactorKind = AuthFactorKind> = EnrollableFactorService<kind> | ImplicitFactorService<kind>;

/** A factor kind that identifies the visitor, and so may be offered as primary. @public */
export type AuthIdentifyingFactorKind = (typeof AUTH_IDENTIFYING_FACTORS)[number];

/** A factor service that can start a sign-in, because its kind identifies the visitor. @public */
export type AuthIdentifyingFactorService = ImplicitFactorService<AuthIdentifyingFactorKind>;

/** A factor kind that may be offered as a second factor. @public */
export type AuthSecondFactorKind = (typeof AUTH_SECOND_FACTORS)[number];

/** A factor service a user may enrol as their second factor. @public */
export type AuthSecondFactorService = EnrollableFactorService<AuthSecondFactorKind>;

/** Whether every user must hold a second factor of this kind, or may enrol it by choice. @public */
export type AuthSecondFactorRequirement = "mandatory" | "optional";

/** One offered second factor and what this deployment demands of it. @public */
export interface AuthSecondFactorOffer {
  readonly service: AuthSecondFactorService;
  readonly requirement: AuthSecondFactorRequirement;
}

/** The second factors this deployment offers, each mandatory or optional, and the recovery codes beside them. @public */
export interface AuthSecondFactorOffering {
  /** In the order every page lists them, and the order owed kinds are enrolled in. */
  readonly offered: readonly [AuthSecondFactorOffer, ...AuthSecondFactorOffer[]];
  readonly recovery: RecoveryCodeFactorService;
}

/** @public */
export interface AuthFactorsOptions {
  readonly primary: AuthIdentifyingFactorService;
  /** Absent, and nothing here can re-authenticate. */
  readonly second?: AuthSecondFactorOffering;
}

/** What a second factor demands of this sign-in. `enrolment-required` is an outcome, not a failure. @public */
export type AuthFactorResolution =
  | { readonly status: "satisfied" }
  | { readonly status: "step-up-required"; readonly kinds: readonly AuthFactorKind[] }
  | {
      readonly status: "enrolment-required";
      /** The mandatory kinds not yet held, in offer order. */
      readonly kinds: readonly AuthFactorKind[];
      /** The confirmed second kinds that must be passed before enrolling. */
      readonly stepUpKinds: readonly AuthFactorKind[];
    };

/** @public */
export interface AuthFactorRegistry {
  readonly primary: AuthIdentifyingFactorService;
  readonly offered: readonly AuthFactorService[];
  /** The second factors this deployment offers, in listing order — empty when nothing here can re-authenticate. */
  readonly seconds: readonly AuthSecondFactorService[];
  /** `null` exactly when `seconds` is empty. */
  readonly recovery: RecoveryCodeFactorService | null;
  /** The kinds every user must hold, in offer order — empty when no second factor is mandatory. */
  readonly mandatory: readonly AuthSecondFactorKind[];
  find(kind: AuthFactorKind): AuthFactorService | undefined;
  resolve(userId: string): Promise<AuthStoreResult<AuthFactorResolution>>;
}

/** @public */
export interface TotpAppFactorOptions {
  keys: KeyRing;
  factors: FactorStore;
  /** Holds a replacement secret, sealed and bound to the session that asked for it, until a code from it confirms the swap. */
  challenges: ChallengeStore;
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

/** The authenticator-app factor, which can also swap a confirmed enrolment's secret for a new one in place. @public */
export interface TotpReplaceableFactorService extends EnrollableFactorService<"totp-app"> {
  /** Resumes the replacement this session has pending, or mints one; the live secret keeps verifying until `completeReplacement` commits. */
  beginReplacement(userId: string, at: number, caller: AuthFactorCaller): Promise<Result<AuthFactorChallenge, AuthFactorReason>>;
  /** Commits the pending secret once `presented` is a code from it, revoking every other session; a wrong code spends the pending secret's own budget, never the live row's. */
  completeReplacement(userId: string, presented: string, at: number, caller: AuthFactorCaller): Promise<Result<AuthFactor, AuthFactorReason>>;
}

/** What an enrolment shows once and never again — the base32 secret and the `otpauth://` URI carrying it. @public */
export type TotpAppEnrolment = { readonly secret: string; readonly uri: string };

/** What the constant-time primitive answered, in the order a factor asked it. @internal */
export type TimingProbe = { compared: boolean[] };

/** A probe and the restore that must run before another suite reads `crypto.subtle`. @internal */
export type TimingProbeHandle = { probe: TimingProbe; restore: () => void };

/** @public */
export interface RecoveryCodeFactorOptions {
  factors: FactorStore;
  codes: RecoveryCodeStore;
  /** Wrong codes this factor admits before it refuses every one, until an accepted code or `lockoutMs` clears them. */
  maxAttempts?: number;
  /** How long a spent budget stays refused before a new guess reopens it. Defaults to `AUTH_TOTP_LOCKOUT_MS`. */
  lockoutMs?: number;
}

/** The single-use recovery-code factor, and how many unused codes a user still holds. @public */
export interface RecoveryCodeFactorService extends EnrollableFactorService<"recovery-code"> {
  remaining(userId: string): Promise<AuthStoreResult<number>>;
}
