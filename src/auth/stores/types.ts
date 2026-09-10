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
