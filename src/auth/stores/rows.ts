import { uuidFromBytes, uuidToBytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client, SqlFragment } from "../../storage/db/types";
import { AuthStoreError } from "../errors";
import type { AdminUserOutcome, AuthCredential, AuthFactor, AuthFactorKind, AuthIdentityLink, AuthStoreResult, AuthUser } from "../types";
import type { CredentialRow, FactorRow, IdentityLinkRow, UserRow } from "./types";

/** How many rows a listing returns when the caller names no limit. @internal */
export const DEFAULT_PAGE_LIMIT = 50;

/** The most rows one page may ask for. @internal */
export const MAX_PAGE_LIMIT = 200;

/** Clamps a caller's page size into the range a statement may bind — SQLite reads `LIMIT -1` as no limit. @internal */
export function pageLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(limit)));
}

// `tests/workerd/auth-schema.test.ts` measures a plain number array from the D1 workerd answers
// with; the `Uint8Array` and `ArrayBuffer` branches are what a binding that answers otherwise needs.
/** Reads a BLOB column back as bytes whichever shape the binding handed over. @internal */
export function blobBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (value instanceof Uint8Array) return value as Uint8Array<ArrayBuffer>;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  throw new TypeError("user store: expected a BLOB column to read back as bytes");
}

// `uuidToBytes` throws, and every call site binds it as an argument to the query — in the caller's
// frame, before the `Result` boundary inside the client exists to catch anything.
/** Converts an id to its key bytes, answering `null` for anything not a canonical UUID. @internal */
export function uuidKey(id: string): Uint8Array<ArrayBuffer> | null {
  try {
    return uuidToBytes(id);
  } catch {
    // Deliberately not carried forward: `uuidToBytes` puts the rejected id in its message.
    return null;
  }
}

/** Runs a row decode inside the `Result` boundary, so a corrupt column is `unavailable` and not a throw. @internal */
export function readRow<T>(operation: string, read: () => T): AuthStoreResult<T> {
  try {
    return ok(read());
  } catch (cause) {
    return err(new AuthStoreError("unavailable", operation, { cause }));
  }
}

// An insert is the one shape with no in-band "no such row". A foreign key pointing at a malformed
// id is what the constraint would have refused, so the caller sees the failure the backend gives.
/** The failure an insert reports when the owner id it must reference is not a canonical UUID. @internal */
export function unknownOwner(operation: string): AuthStoreError {
  return new AuthStoreError("unavailable", operation);
}

/** Folds a queried row into a finder's contract: the decoded row, `null` when there was none, `unavailable` when it will not decode. @internal */
export function readMaybe<R, T>(operation: string, row: R | null | undefined, read: (row: R) => T): AuthStoreResult<T | null> {
  return row === null || row === undefined ? ok(null) : readRow(operation, () => read(row));
}

function toUuid(value: unknown): string {
  return uuidFromBytes(blobBytes(value));
}

/** Folds a backend failure into the one `AuthStoreError`, naming the index when the backend says which. @internal */
export function storeError(operation: string, cause: unknown): AuthStoreError {
  const message = cause instanceof Error ? cause.message : String(cause);
  // D1 reports `UNIQUE constraint failed: auth_users.email_key: SQLITE_CONSTRAINT (extended: …)`,
  // so the colon has to end the capture or the index name comes back with one stuck to it.
  const constraint = /UNIQUE constraint failed:\s*([^\s:)]+)/i.exec(message)?.[1];
  return constraint ? new AuthStoreError("conflict", operation, { constraint, cause }) : new AuthStoreError("unavailable", operation, { cause });
}

function flag(value: number): boolean {
  return value !== 0;
}

/** @internal */
export function readUser(row: UserRow): AuthUser {
  return {
    id: toUuid(row.id),
    email: row.email,
    emailKey: row.email_key,
    emailVerifiedAt: row.email_verified_at,
    webauthnId: row.webauthn_id === null || row.webauthn_id === undefined ? null : blobBytes(row.webauthn_id),
    isAdmin: flag(row.is_admin),
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @internal */
export function readFactor(row: FactorRow): AuthFactor {
  return {
    id: toUuid(row.id),
    userId: toUuid(row.user_id),
    kind: row.kind as AuthFactorKind,
    secret: row.secret === null || row.secret === undefined ? null : blobBytes(row.secret),
    lastCounter: row.last_counter,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readTransports(value: string | null): string[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? (parsed as string[]) : [];
}

/** @internal */
export function readCredential(row: CredentialRow): AuthCredential {
  return {
    id: toUuid(row.id),
    userId: toUuid(row.user_id),
    credentialId: row.credential_id,
    publicKey: row.public_key === null || row.public_key === undefined ? new Uint8Array() : blobBytes(row.public_key),
    algorithm: row.algorithm as AuthCredential["algorithm"],
    signCount: row.sign_count,
    transports: readTransports(row.transports),
    backupEligible: flag(row.backup_eligible),
    backedUp: flag(row.backed_up),
    label: row.label,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @internal */
export function readIdentityLink(row: IdentityLinkRow): AuthIdentityLink {
  return {
    id: toUuid(row.id),
    userId: toUuid(row.user_id),
    provider: row.provider,
    subject: row.subject,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Joins values into one parenthesised `IN` list, each still a bind parameter. @internal */
export function inList(values: readonly unknown[]): SqlFragment {
  return values.map((value) => sql`${value}`).reduce((left, right) => sql`${left}, ${right}`);
}

/** Matches a row unless it is the only admin who could still sign in — a deactivated one cannot recover a deployment. @internal */
export const NOT_LAST_ADMIN: SqlFragment = sql`(is_admin = 0 OR deactivated_at IS NOT NULL OR (SELECT COUNT(*) FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL) > 1)`;

/** The same guard, as a predicate on a child table's row. @internal */
export function ownerRemovable(key: Uint8Array<ArrayBuffer>): SqlFragment {
  return sql`EXISTS (SELECT 1 FROM auth_users WHERE id = ${key} AND ${NOT_LAST_ADMIN})`;
}

/** Names why a guarded administrative write changed nothing, reading the row only once it has declined. @internal */
export async function adminRefusal(
  db: D1Client,
  operation: string,
  key: Uint8Array<ArrayBuffer>,
  refused: AdminUserOutcome,
): Promise<AuthStoreResult<AdminUserOutcome>> {
  const found = await db.queryOne<{ id: unknown }>(sql`SELECT id FROM auth_users WHERE id = ${key}`);
  return found.ok ? ok(found.data ? refused : ("not-found" as const)) : err(storeError(operation, found.error));
}
