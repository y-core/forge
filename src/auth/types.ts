import type { RequestContext } from "@remix-run/fetch-router";

import type { CoseAlgorithm } from "../crypto/mod";
import type { Result } from "../result/result";
import type { AuthStoreError } from "./errors";

/** A COSE algorithm identifier a passkey ceremony may advertise. @public */
export type AuthAlgorithm = CoseAlgorithm;

/** Root key material for one deployment — the active key id, plus every id still valid for reads. @public */
export interface AuthKeyRing {
  activeKeyId: string;
  keys: Record<string, Uint8Array<ArrayBuffer>>;
}

/** Resolves the auth root key material from the request context. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- context shape varies per consumer
export type AuthSecretResolver = (c: RequestContext<any, any>) => AuthKeyRing | Promise<AuthKeyRing>;

/** Behaviour configuration for the auth namespace. @public */
export interface AuthOptions {
  secret: AuthSecretResolver;
  algorithms?: readonly AuthAlgorithm[];
}

/** The auth capabilities resolved for one request. @public */
export interface AuthServices {
  readonly algorithms: readonly AuthAlgorithm[];
  readonly keys: AuthKeyRing;
}

/** A user record as the auth domain sees it — `emailKey` is the normalized form the unique index holds. @public */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly emailKey: string;
  readonly emailVerifiedAt: number | null;
  readonly webauthnId: Uint8Array<ArrayBuffer> | null;
  readonly isAdmin: boolean;
  readonly deactivatedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Which credential a factor represents. Closed, so a fourth factor is a deliberate edit. @public */
export type AuthFactorKind = "email-otp" | "passkey" | "totp-app";

/** Every store operation resolves to this: an outcome, or the one I/O error. @public */
export type AuthStoreResult<T> = Result<T, AuthStoreError>;

/** The fields a caller supplies when a user record is created. @public */
export interface AuthUserInput {
  readonly email: string;
  readonly emailKey: string;
  readonly isAdmin?: boolean;
  readonly emailVerifiedAt?: number | null;
}

/** One page of a user listing — a cursor over the time-ordered primary key. @public */
export interface AuthUserPage {
  readonly limit?: number;
  readonly after?: string;
}

/** An enrolled second or primary factor. `secret` is sealed at rest, never plaintext. @public */
export interface AuthFactor {
  readonly id: string;
  readonly userId: string;
  readonly kind: AuthFactorKind;
  readonly secret: Uint8Array<ArrayBuffer> | null;
  readonly lastCounter: number | null;
  readonly confirmedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The fields a caller supplies when a factor is enrolled. @public */
export interface AuthFactorInput {
  readonly userId: string;
  readonly kind: AuthFactorKind;
  readonly secret?: Uint8Array<ArrayBuffer> | null;
  readonly confirmedAt?: number | null;
}

/** A registered WebAuthn credential, `credentialId` in the base64url form the browser reports. @public */
export interface AuthCredential {
  readonly id: string;
  readonly userId: string;
  readonly credentialId: string;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly algorithm: AuthAlgorithm;
  readonly signCount: number;
  readonly transports: readonly string[];
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
  readonly label: string | null;
  readonly lastUsedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The fields a caller supplies when a credential is registered. @public */
export interface AuthCredentialInput {
  readonly userId: string;
  readonly credentialId: string;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly algorithm: AuthAlgorithm;
  readonly signCount: number;
  readonly transports?: readonly string[];
  readonly backupEligible?: boolean;
  readonly backedUp?: boolean;
  readonly label?: string | null;
}

/** A federated identity bound to a local user. @public */
export interface AuthIdentityLink {
  readonly id: string;
  readonly userId: string;
  readonly provider: string;
  readonly subject: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The fields a caller supplies when a federated identity is linked. @public */
export interface AuthIdentityLinkInput {
  readonly userId: string;
  readonly provider: string;
  readonly subject: string;
}

/** A stored ceremony challenge, bound to the session that started it. @public */
export interface AuthChallenge {
  readonly challenge: string;
  readonly sessionId: string;
  readonly userId?: string;
}

/** What an `AuthNotifier` is asked to deliver. Forge ships the contract and no transport. @public */
export interface AuthMessage {
  readonly to: string;
  readonly kind: "email-change" | "otp";
  readonly expiresAt: number;
  readonly code?: string;
  readonly url?: string;
}

/** Reads and writes a sign-in service is allowed to make. Deleting a user is absent by design. @public */
export interface UserStore {
  findById(id: string): Promise<AuthStoreResult<AuthUser | null>>;
  findByEmailKey(emailKey: string): Promise<AuthStoreResult<AuthUser | null>>;
  findByWebAuthnId(webauthnId: Uint8Array<ArrayBuffer>): Promise<AuthStoreResult<AuthUser | null>>;
  create(input: AuthUserInput, at: number): Promise<AuthStoreResult<AuthUser>>;
  setWebAuthnIdIfAbsent(id: string, webauthnId: Uint8Array<ArrayBuffer>, at: number): Promise<AuthStoreResult<AuthUser | null>>;
  markEmailVerified(id: string, at: number): Promise<AuthStoreResult<boolean>>;
  changeEmail(id: string, email: string, emailKey: string, at: number): Promise<AuthStoreResult<boolean>>;
}

/** What an administrative write did to the row it named — one member per refusal, so each guard says which it was. @public */
export type AdminUserOutcome = "changed" | "last-admin-deactivate" | "last-admin-delete" | "last-admin-demote" | "not-found";

/** The administrative surface, split from `UserStore` so a sign-in service cannot hold it. @public */
export interface AdminUserStore {
  findById(id: string): Promise<AuthStoreResult<AuthUser | null>>;
  list(page?: AuthUserPage): Promise<AuthStoreResult<readonly AuthUser[]>>;
  search(query: string, page?: AuthUserPage): Promise<AuthStoreResult<readonly AuthUser[]>>;
  /** Counts admins who could still sign in, matching the guard behind the three writes below. */
  countAdmins(): Promise<AuthStoreResult<number>>;
  setAdmin(id: string, isAdmin: boolean, at: number): Promise<AuthStoreResult<AdminUserOutcome>>;
  setDeactivated(id: string, deactivated: boolean, at: number): Promise<AuthStoreResult<AdminUserOutcome>>;
  remove(id: string): Promise<AuthStoreResult<AdminUserOutcome>>;
}

/** @public */
export interface FactorStore {
  listByUser(userId: string): Promise<AuthStoreResult<readonly AuthFactor[]>>;
  find(userId: string, kind: AuthFactorKind): Promise<AuthStoreResult<AuthFactor | null>>;
  findEnrolled(userId: string, kinds: readonly AuthFactorKind[]): Promise<AuthStoreResult<readonly AuthFactor[]>>;
  enrol(input: AuthFactorInput, at: number): Promise<AuthStoreResult<AuthFactor>>;
  confirm(id: string, userId: string, at: number): Promise<AuthStoreResult<boolean>>;
  /** Spends one guess against this factor and reports whether the budget admitted it — both in the one statement. */
  countAttempt(id: string, userId: string, maxAttempts: number, at: number): Promise<AuthStoreResult<boolean>>;
  /** Records an accepted step above the last one, and clears the spent guesses that led to it. */
  advanceCounter(id: string, userId: string, counter: number, at: number): Promise<AuthStoreResult<boolean>>;
  remove(id: string, userId: string): Promise<AuthStoreResult<boolean>>;
}

/** @public */
export interface CredentialStore {
  listByUser(userId: string): Promise<AuthStoreResult<readonly AuthCredential[]>>;
  findByCredentialId(credentialId: string): Promise<AuthStoreResult<AuthCredential | null>>;
  create(input: AuthCredentialInput, at: number): Promise<AuthStoreResult<AuthCredential>>;
  recordUse(id: string, signCount: number, backedUp: boolean, at: number): Promise<AuthStoreResult<boolean>>;
  relabel(id: string, userId: string, label: string | null, at: number): Promise<AuthStoreResult<boolean>>;
  removeForUser(id: string, userId: string): Promise<AuthStoreResult<boolean>>;
}

/** @public */
export interface IdentityLinkStore {
  find(provider: string, subject: string): Promise<AuthStoreResult<AuthIdentityLink | null>>;
  listByUser(userId: string): Promise<AuthStoreResult<readonly AuthIdentityLink[]>>;
  link(input: AuthIdentityLinkInput, at: number): Promise<AuthStoreResult<AuthIdentityLink>>;
  unlink(id: string): Promise<AuthStoreResult<boolean>>;
}

/** `take` is read-and-delete, which makes "clear the challenge even on failure" structural. @public */
export interface ChallengeStore {
  put(key: string, challenge: AuthChallenge, ttlSeconds: number): Promise<AuthStoreResult<void>>;
  take(key: string): Promise<AuthStoreResult<AuthChallenge | null>>;
}

/** `markConsumed` reports `true` only the first time a key is seen. @public */
export interface NonceStore {
  markConsumed(key: string, ttlSeconds: number): Promise<AuthStoreResult<boolean>>;
}

/** The delivery seam. Forge ships this contract and no mailer — the transport is the consumer's. @public */
export interface AuthNotifier {
  send(message: AuthMessage): Promise<AuthStoreResult<void>>;
}

/** One identity's outstanding email code and the guesses spent against it. @public */
export interface OtpState {
  readonly token: string;
  readonly attempts: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

// Every method here decides in one statement: these are security counters on the primary factor,
// and a read followed by a write hands every parallel request a free extra guess.
/** The live email code for one identity — the two conditional writes the factor rests on. @public */
export interface OtpStateStore {
  /** Writes the code unless one was issued within `cooldownMs`; `false` is the cooldown refusing. */
  issue(userId: string, state: OtpState, cooldownMs: number): Promise<AuthStoreResult<boolean>>;
  /** Spends one guess and returns the code it was spent against; `null` when there is none to spend. */
  countAttempt(userId: string, maxAttempts: number, at: number): Promise<AuthStoreResult<OtpState | null>>;
  /** The live code without spending a guess — how a refused attempt is told from an expired one. */
  read(userId: string, at: number): Promise<AuthStoreResult<OtpState | null>>;
  clear(userId: string): Promise<AuthStoreResult<void>>;
}
