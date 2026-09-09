-- @y-core/forge/auth — Cloudflare D1 schema.
--
-- Apply it from an installed copy of the package, which is a filesystem path and not an import:
--   wrangler d1 execute <DB> --file node_modules/@y-core/forge/src/auth/schema.sql
--
-- The `auth_` prefix is fixed. Making it configurable would need raw identifier concatenation,
-- which is the one thing `src/storage/db/sql.ts` exists to forbid and offers no escape hatch for.
--
-- Primary keys are 16-byte UUIDv7 BLOBs. Bytewise sort is time order, so no table needs an index
-- on `created_at` to page newest-first.
--
-- Timestamps are epoch milliseconds as INTEGER.
--
-- Every FOREIGN KEY here is documentation. D1 does not guarantee `PRAGMA foreign_keys` is on, so
-- the adapters delete children explicitly in a `batch()` and correctness never rests on the pragma.
--
-- `tests/workerd/auth-schema.test.ts` applies this file to a real D1 and holds the facts it depends
-- on: STRICT is accepted and enforced, `batch()` rolls back whole on a mid-batch failure, a BLOB
-- column reads back with its bytes intact, and the shipped adapters' guards decide as they claim to
-- when their SQL is the thing being executed.

CREATE TABLE IF NOT EXISTS auth_users (
  id BLOB PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  -- Fed by `normalizeEmail`, never `COLLATE NOCASE`: that collation folds ASCII only, and it is
  -- invisible at the query site, where a reader cannot tell which comparisons are case-folded.
  email_key TEXT NOT NULL,
  email_verified_at INTEGER,
  -- The WebAuthn user handle a discoverable login resolves the account from, minted lazily on the
  -- first registration. A unique index admits many NULLs, so every user without a passkey shares it.
  webauthn_id BLOB,
  is_admin INTEGER NOT NULL DEFAULT 0,
  deactivated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_key ON auth_users (email_key);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_webauthn_id ON auth_users (webauthn_id);
CREATE INDEX IF NOT EXISTS auth_users_is_admin ON auth_users (is_admin);

CREATE TABLE IF NOT EXISTS auth_factors (
  id BLOB PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  -- The TOTP shared secret, sealed under the `totpWrap` subkey. NULL for a factor that keeps none.
  secret BLOB,
  -- The last TOTP step a code was accepted at; the conditional advance refuses anything at or below it.
  last_counter INTEGER,
  -- Guesses spent against this factor since the last accepted code. Spent by the statement that
  -- admits the guess, so parallel attempts cannot each compare against a count none has written.
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_factors_user_kind ON auth_factors (user_id, kind);

CREATE TABLE IF NOT EXISTS auth_credentials (
  id BLOB PRIMARY KEY NOT NULL,
  user_id BLOB NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  -- base64url, as the browser reports it, so no decode step stands between a ceremony and a lookup.
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

-- The live emailed code for one identity, and the guesses spent against it. Durable and not KV:
-- both counters are conditional writes on the primary factor, and KV can only read then write, so
-- parallel guesses would each be compared against the same count.
--
-- There is no TTL here. A row is dead once `expires_at` passes — every read holds it against the
-- clock — and the next issue for that identity overwrites it. A user who never returns leaves one
-- row of no consequence behind.
CREATE TABLE IF NOT EXISTS auth_otp_state (
  user_id BLOB PRIMARY KEY NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  -- The sealed code, as `encodeAuthToken` framed it. The code itself is never stored.
  token TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
