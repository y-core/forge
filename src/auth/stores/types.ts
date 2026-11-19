import type { KeyRing } from "../../crypto/keyring/types";
import type { SqlFragment } from "../../storage/db/types";
import type { AuthSecondFactorKind } from "../factors/types";
import type { AuthFactorKind, AuthSecurityEventType } from "../types";

/** The mandatory kinds, whose last confirmed row a removal may not take; empty where any second factor may go. @public */
export type AuthSecondFactorFloor = readonly AuthSecondFactorKind[];

/** @public */
export interface ChallengeStoreOptions {
  prefix?: string;
}

/** @public */
export interface NonceStoreOptions {
  prefix?: string;
}

/** What a scheduled `purgeAuthEphemera` call spares. @public */
export interface AuthEphemeraPurgeOptions {
  /** How long an account that never verified its address is kept, measured from its creation. */
  readonly unverifiedUserTtlMs?: number;
  /** How long a security event is kept, measured from when it happened. Defaults to `AUTH_SECURITY_EVENT_TTL_MS`. */
  readonly securityEventTtlMs?: number;
}

/** What one `purgeAuthEphemera` call deleted, and whether it reached every lapsed row. @public */
export interface AuthEphemeraPurgeReport {
  /** Rows deleted from each table; the children an account's deletion cascades to are not counted. */
  readonly deleted: {
    readonly challenges: number;
    readonly nonces: number;
    readonly signIns: number;
    readonly users: number;
    readonly securityEvents: number;
  };
  /** `false` when a table's step ceiling ran out or a constraint blocked it, so lapsed rows wait for the next run. */
  readonly complete: boolean;
  /** The tables, in run order, whose step a foreign-key, NOT NULL or CHECK constraint refused — from an app key to an auth table that the migration lint refuses, since a purge delete writes no value itself. */
  readonly blocked: readonly (keyof AuthEphemeraPurgeReport["deleted"])[];
}

/** One security event as a mutation's batch writes it, with a fragment where only the statement knows the value. @internal */
export interface AuthSecurityEventWrite {
  readonly userKey: Uint8Array<ArrayBuffer> | SqlFragment;
  readonly type: AuthSecurityEventType;
  readonly factorKind: AuthFactorKind | SqlFragment | null;
  /** SHA-256 of the acting session's token, which the row names by that session's public id. */
  readonly keep: Uint8Array<ArrayBuffer> | null;
  readonly adminKey: Uint8Array<ArrayBuffer> | null;
  readonly at: number;
}

/** How long a session store keeps a session resolving. @public */
export interface AuthSessionStoreOptions {
  /** How long a session lasts from sign-in, in milliseconds. Defaults to `AUTH_SESSION_MAX_MS`. */
  readonly absoluteLifetimeMs?: number;
  /** How long a session may go unused before it stops resolving, in milliseconds; `null` for no idle bound. Defaults to `AUTH_SESSION_IDLE_MS`, or the absolute lifetime where that is shorter. */
  readonly idleTimeoutMs?: number | null;
}

/** The lifetimes a session store holds a session to, and how stale `last_seen_at` may grow before `resolve` writes a fresher one. @internal */
export interface AuthSessionBounds {
  readonly absoluteLifetimeMs: number;
  readonly idleTimeoutMs: number | null;
  readonly touchIntervalMs: number;
}

/** @internal */
export interface OtpStateRow {
  token: string;
  attempts: number;
  issued_at: number;
  expires_at: number;
}

/** @internal */
export interface UserRow {
  id: unknown;
  email: string;
  email_key: string;
  email_verified_at: number | null;
  webauthn_id: unknown;
  is_admin: number;
  deactivated_at: number | null;
  created_at: number;
  updated_at: number;
}

/** @internal */
export interface AuthSessionRecordRow {
  session_id: unknown;
  signed_in_at: number;
  expires_at: number;
  step_up_at: number | null;
  step_up_kind: string | null;
  last_seen_at: number;
  device: string | null;
}

/** @internal */
export interface AuthSessionRow extends AuthSessionRecordRow {
  id: unknown;
  email: string;
  is_admin: number;
}

/** @internal */
export interface SecurityEventRow {
  id: unknown;
  user_id: unknown;
  type: string;
  factor_kind: string | null;
  session_id: unknown;
  admin_id: unknown;
  at: number;
}

/** @internal */
export interface FactorRow {
  id: unknown;
  user_id: unknown;
  kind: string;
  secret: unknown;
  last_counter: number | null;
  last_verified_at: number | null;
  failed_attempts: number;
  confirmed_at: number | null;
  created_at: number;
  updated_at: number;
}

/** @internal */
export interface CredentialRow {
  id: unknown;
  user_id: unknown;
  credential_id: string;
  public_key: unknown;
  algorithm: number;
  sign_count: number;
  transports: string | null;
  backup_eligible: number;
  backed_up: number;
  label: string | null;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

/** @internal */
export interface IdentityLinkRow {
  id: unknown;
  user_id: unknown;
  provider: string;
  subject: string;
  created_at: number;
  updated_at: number;
}

/** @internal */
export interface AccessTokenRow {
  id: unknown;
  user_id: unknown;
  label: string;
  scopes: string;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

/** What a scheduled `totp-app` secret purge acts on. @public */
export interface TotpSecretPurgeOptions {
  /** The ring itself, never a bare key id: the purge deletes the complement of the active key, so a wrong one deletes the live enrolments. */
  readonly keys: KeyRing;
  /** How long a row must have gone without an accepted code, measured from `last_verified_at` — or from enrolment, for a row that never had one. */
  readonly idleForMs: number;
  /** The kinds the deployment offers and those of them it makes mandatory. Anything but `totp-app` mandatory is refused — see the throw. */
  readonly factors: { readonly offered: readonly AuthSecondFactorKind[]; readonly mandatory: readonly AuthSecondFactorKind[] };
}

/** What one `purgeStaleTotpSecrets` run did with the stale rows it found. @public */
export interface TotpSecretPurgeReport {
  /** Stale rows deleted, each owned by a user holding another offered second factor or an unused recovery code. */
  readonly purged: number;
  /** Stale rows left in place, because deleting them would leave their owner nothing to step up with before re-enrolling. */
  readonly kept: number;
}
