-- @y-core/forge/auth — the desired state of the auth D1 schema. How to apply it, and the rulings its tables carry, are in
-- src/auth/README.md, "Applying the auth schema to your database".

CREATE TABLE IF NOT EXISTS auth_users (
  id BLOB PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  email_key TEXT NOT NULL,
  email_verified_at INTEGER,
  webauthn_id BLOB,
  is_admin INTEGER NOT NULL DEFAULT 0,
  deactivated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  email_change_requested_at INTEGER,
  CHECK (length(email) <= 254 AND length(email_key) <= 254)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_key ON auth_users (email_key);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_webauthn_id ON auth_users (webauthn_id);
CREATE INDEX IF NOT EXISTS auth_users_active_admin ON auth_users (id) WHERE is_admin = 1 AND deactivated_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_users_unverified_created_at ON auth_users (created_at) WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_factors (
  id BLOB PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  secret BLOB,
  last_counter INTEGER,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_verified_at INTEGER,
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_factors_user_kind ON auth_factors (user_id, kind);

CREATE TABLE IF NOT EXISTS auth_credentials (
  id BLOB PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  public_key BLOB NOT NULL,
  algorithm INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  backup_eligible INTEGER NOT NULL DEFAULT 0,
  backed_up INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_credentials_credential_id ON auth_credentials (credential_id);
CREATE INDEX IF NOT EXISTS auth_credentials_user_id ON auth_credentials (user_id);

CREATE TABLE IF NOT EXISTS auth_identity_links (
  id BLOB PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_identity_links_provider_subject ON auth_identity_links (provider, subject);
CREATE INDEX IF NOT EXISTS auth_identity_links_user_id ON auth_identity_links (user_id);

CREATE TABLE IF NOT EXISTS auth_access_tokens (
  id BLOB PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  token_hash BLOB NOT NULL,
  label TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (length(token_hash) = 32 AND length(label) BETWEEN 1 AND 100)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_access_tokens_token_hash ON auth_access_tokens (token_hash);
CREATE INDEX IF NOT EXISTS auth_access_tokens_user_id ON auth_access_tokens (user_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash BLOB PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  signed_in_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  step_up_at INTEGER,
  id BLOB NOT NULL CHECK (length(id) = 16),
  step_up_kind TEXT,
  last_seen_at INTEGER NOT NULL,
  device TEXT CHECK (device IS NULL OR length(device) <= 64),
  CHECK (length(token_hash) = 32 AND expires_at > signed_in_at)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_id ON auth_sessions (id);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_security_events (
  id BLOB PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  factor_kind TEXT,
  session_id BLOB,
  admin_id BLOB,
  at INTEGER NOT NULL,
  CHECK (length(type) BETWEEN 1 AND 32 AND (factor_kind IS NULL OR length(factor_kind) <= 32))
) STRICT;

CREATE INDEX IF NOT EXISTS auth_security_events_user_id ON auth_security_events (user_id, id);
CREATE INDEX IF NOT EXISTS auth_security_events_at ON auth_security_events (at);

CREATE TABLE IF NOT EXISTS auth_recovery_codes (
  id BLOB PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  code_hash BLOB NOT NULL CHECK (length(code_hash) = 32),
  staged INTEGER NOT NULL DEFAULT 0 CHECK (staged IN (0, 1)),
  used_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_recovery_codes_user_hash ON auth_recovery_codes (user_id, code_hash);

CREATE TABLE IF NOT EXISTS auth_otp_state (
  user_id BLOB PRIMARY KEY NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  window_started_at INTEGER,
  binding BLOB CHECK (binding IS NULL OR length(binding) = 32)
) STRICT;

CREATE TABLE IF NOT EXISTS auth_challenges (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS auth_challenges_expires_at ON auth_challenges (expires_at);

CREATE TABLE IF NOT EXISTS auth_nonces (
  key TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS auth_nonces_expires_at ON auth_nonces (expires_at);
