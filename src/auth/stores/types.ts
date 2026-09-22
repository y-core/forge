import type { AuthFactorRequirement } from "../factors/types";
import type { AuthKeyRing } from "../types";

/** @public */
export interface ChallengeStoreOptions {
  prefix?: string;
}

/** @public */
export interface NonceStoreOptions {
  prefix?: string;
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
  sessions_invalid_before: number | null;
  created_at: number;
  updated_at: number;
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

/** What a scheduled `totp-app` secret purge acts on. @public */
export interface TotpSecretPurgeOptions {
  /** The ring itself, never a bare key id: the purge deletes the complement of the active key, so a wrong one deletes the live enrolments. */
  readonly keys: AuthKeyRing;
  /** How long a row must have gone without an accepted code, measured from `last_verified_at` — or from enrolment, for a row that never had one. */
  readonly idleForMs: number;
  /** What the deployment offers `totp-app` under. Anything but `mandatory` is refused — see the throw. */
  readonly requirement: AuthFactorRequirement;
}
