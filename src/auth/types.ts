import type { Result } from "../result/types";
import type { AuthStoreError } from "./errors";
import type { CoseAlgorithm } from "./passkey/types";
import type { AuthSecondFactorFloor } from "./stores/types";

/** A COSE algorithm identifier a passkey ceremony may advertise. @public */
export type AuthAlgorithm = CoseAlgorithm;

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

/** Which credential a factor represents. @public */
export type AuthFactorKind = "email-otp" | "passkey" | "recovery-code" | "totp-app";

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

/** An enrolled second or primary factor, its `secret` sealed at rest. @public */
export interface AuthFactor {
  readonly id: string;
  readonly userId: string;
  readonly kind: AuthFactorKind;
  readonly secret: Uint8Array<ArrayBuffer> | null;
  readonly lastCounter: number | null;
  readonly failedAttempts: number;
  /** When a code was last accepted — `updated_at` also moves on a spent guess, so it cannot say this. */
  readonly lastVerifiedAt: number | null;
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

/** An issued access token as stored — the secret itself is never part of it. @public */
export interface AuthAccessToken<Scope extends string = string> {
  readonly id: string;
  readonly userId: string;
  readonly label: string;
  readonly scopes: readonly Scope[];
  readonly expiresAt: number | null;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
  readonly createdAt: number;
}

/** @public */
export interface AuthAccessTokenInput {
  readonly userId: string;
  readonly tokenHash: Uint8Array<ArrayBuffer>;
  readonly label: string;
  readonly scopes: readonly string[];
  readonly expiresAt: number | null;
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

/** Where a security-relevant write was made from: which session its event row names, and the one session a revoking write spares. @public */
export interface AuthWriteOrigin {
  /** SHA-256 of the acting session's token; `null` spares no session and names none. */
  readonly keep: Uint8Array<ArrayBuffer> | null;
}

/** What a security event row records happened to an account. @public */
export type AuthSecurityEventType =
  | "signed-in"
  | "stepped-up"
  | "sessions-revoked"
  | "factor-added"
  | "factor-removed"
  | "factor-replaced"
  | "recovery-codes-issued"
  | "recovery-code-used"
  | "email-changed"
  | "admin-granted"
  | "admin-revoked"
  | "factors-reset"
  | "account-deactivated"
  | "account-reactivated";

/** One security event as its row holds it — never an address, a token or anything a client sent. @public */
export interface AuthSecurityEvent {
  readonly id: string;
  readonly userId: string;
  readonly type: AuthSecurityEventType;
  readonly factorKind: AuthFactorKind | null;
  /** The public id of the session that acted, or `null` where none did. */
  readonly sessionId: string | null;
  /** The administrator who acted, or `null` where the owner did. */
  readonly adminId: string | null;
  readonly at: number;
}

/** Reads an account's security events; every write lands in the batch of the change it records. @public */
export interface AuthSecurityEventStore {
  /** Newest first, paged on the time-ordered key. */
  listByUser(userId: string, page?: AuthUserPage): Promise<AuthStoreResult<readonly AuthSecurityEvent[]>>;
}

/** The event types a user is told about. @public */
export type AuthNotifiedEventType = Exclude<AuthSecurityEventType, "signed-in" | "stepped-up" | "sessions-revoked">;

/** What a security notice tells the account holder happened. @public */
export interface AuthSecurityNotice {
  readonly type: AuthNotifiedEventType;
  readonly factorKind: AuthFactorKind | null;
  readonly at: number;
}

/** What an `AuthNotifier` is asked to deliver. @public */
export type AuthMessage =
  | { readonly to: string; readonly kind: "otp"; readonly code: string; readonly expiresAt: number }
  | { readonly to: string; readonly kind: "email-change"; readonly url: string; readonly expiresAt: number }
  | { readonly to: string; readonly kind: "security-event"; readonly notice: AuthSecurityNotice };

/** Reads and writes a sign-in service is allowed to make. @public */
export interface UserStore {
  findById(id: string): Promise<AuthStoreResult<AuthUser | null>>;
  findByEmailKey(emailKey: string): Promise<AuthStoreResult<AuthUser | null>>;
  findByWebAuthnId(webauthnId: Uint8Array<ArrayBuffer>): Promise<AuthStoreResult<AuthUser | null>>;
  create(input: AuthUserInput, at: number): Promise<AuthStoreResult<AuthUser>>;
  setWebAuthnIdIfAbsent(id: string, webauthnId: Uint8Array<ArrayBuffer>, at: number): Promise<AuthStoreResult<AuthUser | null>>;
  markEmailVerified(id: string, at: number): Promise<AuthStoreResult<boolean>>;
  /** Moves the address, marks it verified, records `email-changed` and deletes every session the user holds, in one batch. */
  changeEmail(id: string, email: string, emailKey: string, at: number): Promise<AuthStoreResult<boolean>>;
  /** Stamps an address-change request unless one was stamped within `cooldownMs`, deciding in the one statement; `false` is the cooldown refusing. */
  claimEmailChange(id: string, at: number, cooldownMs: number): Promise<AuthStoreResult<boolean>>;
}

/** What an administrative write did to the row it named: changed it, found it already so, or one member per refusal. @public */
export type AdminUserOutcome =
  | "admin-exists"
  | "changed"
  | "last-admin-deactivate"
  | "last-admin-delete"
  | "last-admin-demote"
  | "not-found"
  | "referenced"
  | "self"
  | "unchanged";

/** What a factor or credential removal did: removed it, found none of the user's, or refused to leave them below the second-factor floor. @public */
export type AuthFactorRemoval = "changed" | "not-found" | "second-factor-required";

/** The administrative surface, split from `UserStore` so a sign-in service cannot hold it. @public */
export interface AdminUserStore {
  findById(id: string): Promise<AuthStoreResult<AuthUser | null>>;
  list(page?: AuthUserPage): Promise<AuthStoreResult<readonly AuthUser[]>>;
  search(query: string, page?: AuthUserPage): Promise<AuthStoreResult<readonly AuthUser[]>>;
  /** Counts admins who could still sign in, matching the guard behind the writes below. */
  countAdmins(): Promise<AuthStoreResult<number>>;
  /** Takes the role while the deployment has none, deciding that in the statement that writes — `admin-exists` is the refusal — and records `admin-granted` and moves the claimant's session per `rotation` in the same batch, only where the claim landed. */
  claimFirstAdmin(id: string, at: number, rotation?: AuthSessionRotation): Promise<AuthStoreResult<AdminUserOutcome>>;
  /** Grants or revokes the role, recording which `adminId` did so in the same batch where the role changed; `unchanged` is a row already holding it. */
  setAdmin(id: string, isAdmin: boolean, at: number, adminId: string): Promise<AuthStoreResult<AdminUserOutcome>>;
  /** Deactivating deletes every session the user holds in the same batch, so reactivating revives none; either records which `adminId` did so where the state changed, and `unchanged` is a row already in it. */
  setDeactivated(id: string, deactivated: boolean, at: number, adminId: string): Promise<AuthStoreResult<AdminUserOutcome>>;
  remove(id: string): Promise<AuthStoreResult<AdminUserOutcome>>;
  /** Deletes every factor, credential and recovery code the user holds, revokes their bearer tokens, deletes their sessions and records which `adminId` did so, in one batch. */
  resetFactors(id: string, at: number, adminId: string): Promise<AuthStoreResult<AdminUserOutcome>>;
}

/** @public */
export interface FactorStore {
  listByUser(userId: string): Promise<AuthStoreResult<readonly AuthFactor[]>>;
  find(userId: string, kind: AuthFactorKind): Promise<AuthStoreResult<AuthFactor | null>>;
  /** The kinds among `kinds` the user holds a confirmed row of, read without any secret. */
  listConfirmedKinds(userId: string, kinds: readonly AuthFactorKind[]): Promise<AuthStoreResult<readonly AuthFactorKind[]>>;
  enrol(input: AuthFactorInput, at: number): Promise<AuthStoreResult<AuthFactor>>;
  /** Confirms an unconfirmed factor, recording `factor-added` from `origin` and deleting every other session the user holds in the same batch for any kind but `passkey`, whose credential does both; `false` when no unconfirmed row matched. */
  confirm(id: string, userId: string, at: number, origin: AuthWriteOrigin): Promise<AuthStoreResult<boolean>>;
  /** Finds the factor, spends one guess against it and returns it, reopening a budget spent more than `lockoutMs` ago — all in the one statement; `null` is no such factor, or the budget refusing. */
  countAttempt(
    userId: string,
    kind: AuthFactorKind,
    maxAttempts: number,
    at: number,
    lockoutMs: number,
  ): Promise<AuthStoreResult<AuthFactor | null>>;
  /** Records an accepted step above the last one on the row still holding `frame`, the sealed secret the code was checked against, clears the spent guesses that led to it, stamps `last_verified_at` — which nothing but this and `replaceSecret` may write — and stores `resealed` in its place where one is passed. */
  recordVerification(
    id: string,
    userId: string,
    counter: number,
    at: number,
    frame: Uint8Array<ArrayBuffer>,
    resealed?: Uint8Array<ArrayBuffer>,
  ): Promise<AuthStoreResult<boolean>>;
  /** Swaps a confirmed `totp-app` row's sealed secret for `secret`, recording `counter` as the accepted step that confirmed it, clearing the spent guesses, recording `factor-replaced` from `origin` and deleting every other session the user holds, in one batch; `false` when no confirmed row of the user's matched. */
  replaceSecret(
    id: string,
    userId: string,
    secret: Uint8Array<ArrayBuffer>,
    counter: number,
    at: number,
    origin: AuthWriteOrigin,
  ): Promise<AuthStoreResult<boolean>>;
  /** Counts rows of `kind` whose sealed secret is under a key id other than `kid` — the population a retiring key still holds. */
  countSecretsNotUnder(kind: AuthFactorKind, kid: string): Promise<AuthStoreResult<number>>;
  /** Deletes the factor unless it is a confirmed row of a `floor` kind, and the user's recovery codes with their row once no confirmed row of an `AUTH_SECOND_FACTORS` kind remains, recording `factor-removed` from `origin` and deleting every other session the user holds where a confirmed factor went. */
  remove(
    id: string,
    userId: string,
    at: number,
    origin: AuthWriteOrigin,
    floor: AuthSecondFactorFloor,
  ): Promise<AuthStoreResult<AuthFactorRemoval>>;
}

/** The hashed recovery codes of each user: a live set, and a staged one awaiting confirmation. @public */
export interface RecoveryCodeStore {
  /** Replaces the user's staged set with `hashes`, leaving the live set untouched. */
  stage(userId: string, hashes: readonly Uint8Array<ArrayBuffer>[], at: number): Promise<AuthStoreResult<void>>;
  holdsStaged(userId: string, hash: Uint8Array<ArrayBuffer>): Promise<AuthStoreResult<boolean>>;
  /** Swaps the staged set in for the live one, confirms `factorId`, clearing its spent guesses, records `recovery-codes-issued` from `origin` and deletes every other session the user holds, in one batch; `false` when no staged set was there to swap. */
  commit(userId: string, factorId: string, at: number, origin: AuthWriteOrigin): Promise<AuthStoreResult<boolean>>;
  /** Spends one live code, clears `factorId`'s spent guesses, records `recovery-code-used` from `origin` and deletes every other session the user holds, in one batch; `false` is no unused live code matching. */
  consume(userId: string, factorId: string, hash: Uint8Array<ArrayBuffer>, at: number, origin: AuthWriteOrigin): Promise<AuthStoreResult<boolean>>;
  /** Counts the live codes not yet used. */
  remaining(userId: string): Promise<AuthStoreResult<number>>;
}

/** @public */
export interface CredentialStore {
  listByUser(userId: string): Promise<AuthStoreResult<readonly AuthCredential[]>>;
  findByCredentialId(credentialId: string): Promise<AuthStoreResult<AuthCredential | null>>;
  /** Inserts the credential, records `factor-added` from `origin` and deletes every other session the owner holds, in one batch. */
  create(input: AuthCredentialInput, at: number, origin: AuthWriteOrigin): Promise<AuthStoreResult<AuthCredential>>;
  recordUse(id: string, signCount: number, backedUp: boolean, at: number): Promise<AuthStoreResult<boolean>>;
  relabel(id: string, userId: string, label: string | null, at: number): Promise<AuthStoreResult<boolean>>;
  /** Deletes the credential unless it is the owner's last and `floor` holds `passkey`, with every session they hold except the one `origin.keep` names, recording `factor-removed`, in one batch. */
  removeForUser(
    id: string,
    userId: string,
    at: number,
    origin: AuthWriteOrigin,
    floor: AuthSecondFactorFloor,
  ): Promise<AuthStoreResult<AuthFactorRemoval>>;
}

/** @public */
export interface AccessTokenStore {
  create(input: AuthAccessTokenInput, at: number): Promise<AuthStoreResult<AuthAccessToken>>;
  /** A token whose owner is deactivated is not found. */
  findByHash(tokenHash: Uint8Array<ArrayBuffer>): Promise<AuthStoreResult<AuthAccessToken | null>>;
  listByUser(userId: string): Promise<AuthStoreResult<readonly AuthAccessToken[]>>;
  /** Stamps `last_used_at` unless one landed within `intervalMs`, deciding in the one statement. */
  recordUse(id: string, at: number, intervalMs: number): Promise<AuthStoreResult<boolean>>;
  revoke(id: string, userId: string, at: number): Promise<AuthStoreResult<boolean>>;
}

/** The fields a sign-in supplies when it creates a session row; `tokenHash` is the SHA-256 of the cookie's token. @public */
export interface AuthSessionInput {
  readonly tokenHash: Uint8Array<ArrayBuffer>;
  readonly userId: string;
  readonly signedInAt: number;
  readonly signedInWith: AuthFactorKind;
  /** When the sign-in itself counts as the session's step-up, as it does for a user owing no second factor. */
  readonly stepUp?: AuthSessionStepUp;
  /** The coarse browser-and-platform label a session list names this sign-in by, at most 64 characters. */
  readonly device?: string | null;
}

/** A step-up as a session row records it. @public */
export interface AuthSessionStepUp {
  readonly at: number;
  readonly kind: AuthFactorKind;
}

/** The session row a privilege change retires, and the hash of the token that replaces it. @public */
export interface AuthSessionRotation {
  readonly replaces: Uint8Array<ArrayBuffer>;
  readonly tokenHash: Uint8Array<ArrayBuffer>;
}

/** One signed-in session as its row holds it — the token itself is never part of it. @public */
export interface AuthSessionRecord {
  /** The handle a session list or an event names this session by, never its token or the token's hash. */
  readonly id: string;
  readonly signedInAt: number;
  readonly expiresAt: number;
  readonly lastSeenAt: number;
  readonly stepUpAt: number | null;
  readonly stepUpKind: AuthFactorKind | null;
  /** The coarse browser-and-platform label recorded at sign-in, or `null` where none was recognised. */
  readonly device: string | null;
}

/** The columns of the owner a per-request session read carries. @public */
export type AuthSessionUser = Pick<AuthUser, "id" | "email" | "isAdmin">;

/** A live session joined to its active owner. @public */
export interface AuthSessionResolved {
  readonly session: AuthSessionRecord;
  readonly user: AuthSessionUser;
}

/** Signed-in sessions, keyed by token hash, and deleted to revoke them. @public */
export interface AuthSessionStore {
  /** Inserts `input`, expiring the store's absolute lifetime after `signedInAt`, and records `signed-in`, deleting the session `replaces` names in the same batch where one is passed. */
  create(input: AuthSessionInput, replaces: Uint8Array<ArrayBuffer> | null): Promise<AuthStoreResult<void>>;
  /** The session `tokenHash` names while `expires_at > at`, it was seen inside the store's idle bound and its owner is not deactivated, joined to that owner; `null` otherwise. */
  resolve(tokenHash: Uint8Array<ArrayBuffer>, at: number): Promise<AuthStoreResult<AuthSessionResolved | null>>;
  /** Moves the session `replaces` names onto `tokenHash` in place, keeping every other column and recording `stepUp` and a `stepped-up` event where given; `false` when there was no such session. */
  rotate(replaces: Uint8Array<ArrayBuffer>, tokenHash: Uint8Array<ArrayBuffer>, stepUp?: AuthSessionStepUp): Promise<AuthStoreResult<boolean>>;
  remove(tokenHash: Uint8Array<ArrayBuffer>): Promise<AuthStoreResult<boolean>>;
  /** The user's sessions live as of `at` under the same expiry and idle bound `resolve` applies, newest sign-in first, at most a page. */
  listByUser(userId: string, at: number): Promise<AuthStoreResult<readonly AuthSessionRecord[]>>;
  /** Deletes the session `sessionId` names when `userId` holds it and it is not the one `origin.keep` names, recording `sessions-revoked` in the same batch; `false` when nothing matched. */
  revoke(userId: string, sessionId: string, at: number, origin: AuthWriteOrigin): Promise<AuthStoreResult<boolean>>;
  /** Deletes every session `userId` holds except the one `origin.keep` names, recording `sessions-revoked` in the same batch where any went, and answers how many went. */
  revokeOthers(userId: string, at: number, origin: AuthWriteOrigin): Promise<AuthStoreResult<number>>;
}

/** @public */
export interface IdentityLinkStore {
  find(provider: string, subject: string): Promise<AuthStoreResult<AuthIdentityLink | null>>;
  listByUser(userId: string): Promise<AuthStoreResult<readonly AuthIdentityLink[]>>;
  link(input: AuthIdentityLinkInput, at: number): Promise<AuthStoreResult<AuthIdentityLink>>;
  /** The owner is in the statement, so a link id belonging to somebody else unlinks nothing. */
  unlink(id: string, userId: string): Promise<AuthStoreResult<boolean>>;
}

/** Stored ceremony challenges, where `take` reads and deletes in one step. @public */
export interface ChallengeStore {
  put(key: string, challenge: AuthChallenge, ttlSeconds: number): Promise<AuthStoreResult<void>>;
  take(key: string): Promise<AuthStoreResult<AuthChallenge | null>>;
}

/** `markConsumed` reports `true` only the first time a key is seen. @public */
export interface NonceStore {
  markConsumed(key: string, ttlSeconds: number): Promise<AuthStoreResult<boolean>>;
}

/** The delivery seam a consumer implements over its own transport. @public */
export interface AuthNotifier {
  send(message: AuthMessage, signal: AbortSignal): Promise<AuthStoreResult<void>>;
}

/** One identity's outstanding email code and the guesses spent against it. @public */
export interface OtpState {
  readonly token: string;
  readonly attempts: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** The live email code for one identity — the conditional writes the factor rests on. @public */
export interface OtpStateStore {
  /** Writes the code bound to the `binding` digest unless one was issued within `cooldownMs`; `false` is the cooldown refusing. */
  issue(userId: string, state: OtpState, cooldownMs: number, binding: Uint8Array<ArrayBuffer>): Promise<AuthStoreResult<boolean>>;
  /** Spends one guess against the identity's window, opening a new one where `windowMs` has passed since the last opened, and returns the code it was spent against; `null` when there is none bound to `binding` to spend. */
  countAttempt(
    userId: string,
    maxAttempts: number,
    at: number,
    windowMs: number,
    binding: Uint8Array<ArrayBuffer>,
  ): Promise<AuthStoreResult<OtpState | null>>;
  /** The live code bound to `binding` without spending a guess — how a refused attempt is told from an expired one. */
  read(userId: string, at: number, binding: Uint8Array<ArrayBuffer>): Promise<AuthStoreResult<OtpState | null>>;
  /** Drops one named code, so an undelivered issue gives its cooldown back without wiping a racing successful one. */
  discard(userId: string, token: string): Promise<AuthStoreResult<void>>;
  clear(userId: string): Promise<AuthStoreResult<void>>;
}

/** Why a store operation failed: a unique index, a CHECK the value broke, a foreign key, or the backend itself. @public */
export type AuthStoreErrorCode = "conflict" | "invalid" | "reference" | "unavailable";

/** What a configured knob may be, and the reason each bound exists. @internal */
export interface AuthLimit {
  fallback: number;
  min: number;
  max?: number;
  unit?: string;
  floor: string;
  ceiling?: string;
}

/** Which ceremony the scope root runs: enrolling a new credential, or signing in with one. @public */
export type PasskeyMode = "registration" | "authentication";

/** Why a ceremony ended without a signed-in visitor. @public */
export type PasskeyFailureReason = "unsupported" | "declined" | "already-enrolled" | "options-failed" | "ceremony-failed" | "verification-failed";

/** `detail` of `PASSKEY_OUTCOME_EVENT`; `reason` is absent exactly when the ceremony succeeded. @public */
export type PasskeyOutcomeDetail = { mode: PasskeyMode; reason?: PasskeyFailureReason };
