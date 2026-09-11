import { uuidToBytes } from "../crypto/mod";
import type { D1DatabaseLike } from "../storage/db/types";
import { fakeD1 } from "./fakes";
import type { FakeD1Options } from "./types";
import type { FakeAuthUser } from "./types";

const EPOCH = 1;

/** The challenge and nonce rows one `fakeAuthD1` holds, so a take spends and a replay loses. */
interface AuthEphemera {
  readonly challenges: Map<string, { value: string; expiresAt: number }>;
  readonly nonces: Set<string>;
}

/** A valid UUID for a factor row the caller did not name one for. */
function derivedId(index: number): string {
  return `00000000-0000-7000-8000-${String(index).padStart(12, "0")}`;
}

// The longer statements are written across several lines, so the text one arrives as carries the
// source's own indentation; folding it away is what lets a branch be read off the store verbatim.
/** One statement with every run of whitespace collapsed to a single space. */
function squash(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function sameBytes(left: unknown, right: Uint8Array | null | undefined): boolean {
  if (!(left instanceof Uint8Array) || right == null || left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function idKey(user: FakeAuthUser): string {
  return user.id.replaceAll("-", "").toLowerCase();
}

/** The accounts in the `ORDER BY id DESC` order a listing pages through — bytewise on a UUIDv7 key is time order. */
function newestFirst(users: readonly FakeAuthUser[]): FakeAuthUser[] {
  return [...users].sort((left, right) => (idKey(left) < idKey(right) ? 1 : idKey(left) > idKey(right) ? -1 : 0));
}

/** Whether an account sorts strictly after a page cursor, which is what `id < ?` selects under that order. */
function pastCursor(user: FakeAuthUser, cursor: unknown): boolean {
  return cursor instanceof Uint8Array && idKey(user) < hex(cursor);
}

/** Whether an account's email key matches the prefix-anchored `LIKE` pattern the admin store builds. */
function matchesTerm(user: FakeAuthUser, term: unknown): boolean {
  if (typeof term !== "string" || !term.endsWith("%")) return false;
  const prefix = term.slice(0, -1).replaceAll(/\\([\\%_])/g, "$1");
  return (user.emailKey ?? user.email.toLowerCase()).startsWith(prefix);
}

function userRow(user: FakeAuthUser): Record<string, unknown> {
  return {
    id: uuidToBytes(user.id),
    email: user.email,
    email_key: user.emailKey ?? user.email.toLowerCase(),
    email_verified_at: user.emailVerifiedAt ?? EPOCH,
    webauthn_id: user.webauthnId ?? null,
    is_admin: user.isAdmin ? 1 : 0,
    deactivated_at: user.deactivatedAt ?? null,
    sessions_invalid_before: user.sessionsInvalidBefore ?? null,
    created_at: user.createdAt ?? EPOCH,
    updated_at: user.updatedAt ?? EPOCH,
  };
}

function factorRows(user: FakeAuthUser): Record<string, unknown>[] {
  return (user.factors ?? []).map((factor, index) => ({
    id: uuidToBytes(factor.id ?? derivedId(index)),
    user_id: uuidToBytes(user.id),
    kind: factor.kind,
    secret: factor.secret ?? null,
    last_counter: factor.lastCounter ?? null,
    failed_attempts: factor.failedAttempts ?? 0,
    confirmed_at: factor.confirmedAt === undefined ? EPOCH : factor.confirmedAt,
    created_at: EPOCH,
    updated_at: EPOCH,
  }));
}

// Matched on the whole statement rather than a substring: the auth stores issue a fixed set, and a
// near-miss answering the wrong rows is worse for a consumer than answering none.
/** The rows one statement selects, or `null` when this fake models no such statement. */
function respond(
  users: readonly FakeAuthUser[],
  ephemera: AuthEphemera,
  sql: string,
  params: readonly unknown[],
): Record<string, unknown>[] | null {
  const owner = (): FakeAuthUser | undefined => users.find((user) => sameBytes(params[0], uuidToBytes(user.id)));

  if (sql === "SELECT * FROM auth_users WHERE id = ?") {
    const found = owner();
    return found ? [userRow(found)] : [];
  }
  if (sql === "SELECT id FROM auth_users WHERE id = ?") {
    const found = owner();
    return found ? [{ id: uuidToBytes(found.id) }] : [];
  }
  if (sql === "SELECT * FROM auth_users WHERE email_key = ?") {
    const found = users.find((user) => (user.emailKey ?? user.email.toLowerCase()) === params[0]);
    return found ? [userRow(found)] : [];
  }
  if (sql === "SELECT * FROM auth_users WHERE webauthn_id = ?") {
    const found = users.find((user) => sameBytes(params[0], user.webauthnId));
    return found ? [userRow(found)] : [];
  }
  if (sql === "SELECT * FROM auth_users ORDER BY id DESC LIMIT ?") {
    return newestFirst(users).slice(0, Number(params[0])).map(userRow);
  }
  if (sql === "SELECT * FROM auth_users WHERE id < ? ORDER BY id DESC LIMIT ?") {
    return newestFirst(users)
      .filter((user) => pastCursor(user, params[0]))
      .slice(0, Number(params[1]))
      .map(userRow);
  }
  if (sql === "SELECT * FROM auth_users WHERE email_key LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?") {
    return newestFirst(users.filter((user) => matchesTerm(user, params[0])))
      .slice(0, Number(params[1]))
      .map(userRow);
  }
  if (sql === "SELECT * FROM auth_users WHERE email_key LIKE ? ESCAPE '\\' AND id < ? ORDER BY id DESC LIMIT ?") {
    return newestFirst(users.filter((user) => matchesTerm(user, params[0])))
      .filter((user) => pastCursor(user, params[1]))
      .slice(0, Number(params[2]))
      .map(userRow);
  }
  if (sql === "SELECT COUNT(*) AS total FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL") {
    return [{ total: users.filter((user) => user.isAdmin === true && (user.deactivatedAt ?? null) === null).length }];
  }
  if (sql === "SELECT * FROM auth_factors WHERE user_id = ? ORDER BY id") {
    const found = owner();
    return found ? factorRows(found) : [];
  }
  if (sql === "SELECT * FROM auth_factors WHERE user_id = ? AND kind = ?") {
    const found = owner();
    return found ? factorRows(found).filter((row) => row.kind === params[1]) : [];
  }
  if (/^SELECT \* FROM auth_factors WHERE user_id = \? AND kind IN \((\?, )*\?\) ORDER BY id$/.test(sql)) {
    const found = owner();
    const kinds = params.slice(1);
    return found ? factorRows(found).filter((row) => kinds.includes(row.kind)) : [];
  }
  // The one read that spends what it reads, which is the whole of the store's single-statement
  // guarantee: a second take finds nothing, so two requests cannot be handed one challenge.
  if (sql === "DELETE FROM auth_challenges WHERE key = ? AND expires_at > ? RETURNING value") {
    const key = String(params[0]);
    const held = ephemera.challenges.get(key);
    if (held === undefined || held.expiresAt <= Number(params[1])) return [];
    ephemera.challenges.delete(key);
    return [{ value: held.value }];
  }
  return null;
}

/** The rows one ephemeral write reports written, or `null` when this fake models no such statement. */
function write(ephemera: AuthEphemera, sql: string, params: readonly unknown[]): number | null {
  if (
    sql ===
    "INSERT INTO auth_challenges (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at"
  ) {
    ephemera.challenges.set(String(params[0]), { value: String(params[1]), expiresAt: Number(params[2]) });
    return 1;
  }
  // Load-bearing: `markConsumed` reads this count as "you were first", so a constant would tell every
  // caller that a replayed token is fresh — the one failure a nonce store exists to prevent.
  if (sql === "INSERT INTO auth_nonces (key, expires_at) VALUES (?, ?) ON CONFLICT (key) DO NOTHING") {
    const key = String(params[0]);
    if (ephemera.nonces.has(key)) return 0;
    ephemera.nonces.add(key);
    return 1;
  }
  return null;
}

// The single largest piece of guesswork in testing a consumer's auth mount was the column names and
// the UUID-as-BLOB binding; this answers the stores' own statements so neither has to be re-derived.
/** A `fakeD1` that answers forge's auth stores from accounts stated in domain terms, holding the challenge and nonce rows it is written. @public */
export function fakeAuthD1(
  users: readonly FakeAuthUser[],
  options?: FakeD1Options,
): D1DatabaseLike & { calls: { sql: string; params: unknown[] }[] } {
  const ephemera: AuthEphemera = { challenges: new Map(), nonces: new Set() };
  // An unmodelled SELECT answers no rows rather than throwing: every store reads "no rows" as the
  // absence it is, not as a failure it cannot describe. A caller's own `rowsWritten` leads, and a
  // `null` from it falls through to what the ephemeral tables actually hold.
  return fakeD1((sql, params) => respond(users, ephemera, squash(sql), params) ?? [], {
    ...options,
    rowsWritten: (sql, params) => options?.rowsWritten?.(sql, params) ?? write(ephemera, squash(sql), params),
  });
}
