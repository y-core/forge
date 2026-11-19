import type { D1DatabaseLike } from "../storage/db/types";
import { uuidToBytes } from "../storage/db/uuid";
import { fakeD1 } from "./fakes";
import type { FakeD1Options } from "./types";
import type { FakeAuthUser } from "./types";

const EPOCH = 1;

/** One `auth_sessions` row, its owner held as the hex of the key bytes the store binds. */
interface SessionSeed {
  readonly userKey: string;
  readonly signedInAt: number;
  readonly expiresAt: number;
  readonly stepUpAt: number | null;
  readonly id: Uint8Array;
  readonly stepUpKind: string | null;
  readonly lastSeenAt: number;
  readonly device: string | null;
}

/** The challenge, nonce, session and security event rows one `fakeAuthD1` holds, so a take spends, a replay loses and a revoked session stays gone. */
interface AuthEphemera {
  readonly challenges: Map<string, { value: string; expiresAt: number }>;
  readonly nonces: Set<string>;
  readonly sessions: Map<string, SessionSeed>;
  /** Each recorded `auth_security_events` row, in the column shape a read returns. */
  readonly events: Record<string, unknown>[];
  /** What the last write reported, which is what a `changes() > 0` guard reads. */
  changes: number;
  /** What a deactivation or reactivation wrote over a seeded account, keyed by the hex of its id bytes. */
  readonly accounts: Map<string, Pick<FakeAuthUser, "deactivatedAt" | "updatedAt">>;
  /** The accounts a deletion removed, keyed by the hex of their id bytes. */
  readonly removed: Set<string>;
  /** When each account last claimed the email-change cooldown, keyed by the hex of its id bytes. */
  readonly emailChanges: Map<string, number>;
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

const FIRST_ROW = /^(SELECT .*) LIMIT 1$/;

const D1_WRITE = /^(INSERT|UPDATE|DELETE|REPLACE)\b/;

const SECURITY_EVENT_INSERT =
  /^INSERT INTO auth_security_events \(id, user_id, type, factor_kind, session_id, admin_id, at\) SELECT \?, (\?|\(SELECT user_id FROM auth_sessions WHERE token_hash = \?\)), \?, \?, (NULL|\(SELECT id FROM auth_sessions WHERE token_hash = \?\)), \?, \? WHERE (1|changes\(\) > 0)$/;

const SECURITY_EVENT_LIST = /^SELECT \* FROM auth_security_events WHERE user_id = \?( AND id < \?)? ORDER BY id DESC LIMIT \?$/;

const SESSION_RESOLVE =
  /^SELECT auth_users\.id, auth_users\.email, auth_users\.is_admin, auth_sessions\.id AS session_id, auth_sessions\.signed_in_at, auth_sessions\.expires_at, auth_sessions\.step_up_at, auth_sessions\.step_up_kind, auth_sessions\.last_seen_at, auth_sessions\.device FROM auth_sessions JOIN auth_users ON auth_users\.id = auth_sessions\.user_id WHERE auth_sessions\.token_hash = \? AND auth_sessions\.expires_at > \? AND auth_users\.deactivated_at IS NULL( AND auth_sessions\.last_seen_at > \?)?$/;

const SESSION_LIST =
  /^SELECT id AS session_id, signed_in_at, expires_at, step_up_at, step_up_kind, last_seen_at, device FROM auth_sessions WHERE user_id = \? AND expires_at > \?( AND last_seen_at > \?)? ORDER BY signed_in_at DESC, id DESC LIMIT \?$/;

const SESSION_REVOCATION = /^DELETE FROM auth_sessions WHERE user_id = \?( AND token_hash != \?)?( AND (changes\(\) > 0|id = \?))?$/;

/** The rows `answer` gives a statement, read past the `LIMIT 1` `queryOne` appends to a read. */
function firstRowOf(sql: string, answer: (statement: string) => Record<string, unknown>[]): Record<string, unknown>[] {
  const inner = FIRST_ROW.exec(sql)?.[1];
  return inner === undefined ? answer(sql) : answer(inner).slice(0, 1);
}

function sameBytes(left: unknown, right: Uint8Array | null | undefined): boolean {
  if (!(left instanceof Uint8Array) || right == null || left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unhex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
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

/** Orders two strings by their UTF-8 bytes, which is how a `BINARY` column compares them. */
function compareBinary(left: string, right: string): number {
  const [a, b] = [new TextEncoder().encode(left), new TextEncoder().encode(right)];
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  return a.length - b.length;
}

/** Whether an account's email key falls in the `email_key >= ? AND email_key < ?` range the admin store searches. */
function inKeyRange(user: FakeAuthUser, from: unknown, to: unknown): boolean {
  const key = user.emailKey ?? user.email.toLowerCase();
  return typeof from === "string" && compareBinary(key, from) >= 0 && (to === null || (typeof to === "string" && compareBinary(key, to) < 0));
}

function userRow(user: FakeAuthUser): Record<string, unknown> {
  return {
    id: uuidToBytes(user.id),
    email: user.email,
    email_key: user.emailKey ?? user.email.toLowerCase(),
    // Not `??`: `null` is the account that never answered a link, and it has to stay unverified.
    email_verified_at: user.emailVerifiedAt === undefined ? EPOCH : user.emailVerifiedAt,
    webauthn_id: user.webauthnId ?? null,
    is_admin: user.isAdmin ? 1 : 0,
    deactivated_at: user.deactivatedAt ?? null,
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
  const stateRead =
    /^SELECT \((deactivated_at IS NOT NULL|deactivated_at IS NULL|is_admin = 1|is_admin = 0)\) AS held FROM auth_users WHERE id = \?$/.exec(sql);
  if (stateRead) {
    const found = owner();
    if (!found) return [];
    const deactivated = (found.deactivatedAt ?? null) !== null;
    const holds: Record<string, boolean> = {
      "deactivated_at IS NOT NULL": deactivated,
      "deactivated_at IS NULL": !deactivated,
      "is_admin = 1": found.isAdmin === true,
      "is_admin = 0": found.isAdmin !== true,
    };
    return [{ held: holds[stateRead[1] ?? ""] ? 1 : 0 }];
  }
  const listed = SECURITY_EVENT_LIST.exec(sql);
  if (listed) {
    const cursor = listed[1] === undefined ? null : keyOf(params[1]);
    return ephemera.events
      .filter((event) => keyOf(event.user_id) === keyOf(params[0]) && (cursor === null || (keyOf(event.id) ?? "") < cursor))
      .sort((left, right) => ((keyOf(left.id) ?? "") < (keyOf(right.id) ?? "") ? 1 : -1))
      .slice(0, Number(params.at(-1)));
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
  const search = /^SELECT \* FROM auth_users WHERE email_key >= \?( AND email_key < \?)?( AND id < \?)? ORDER BY id DESC LIMIT \?$/.exec(sql);
  if (search) {
    const [from, to, cursor] = search[1] ? [params[0], params[1], params[2]] : [params[0], null, params[1]];
    return newestFirst(users.filter((user) => inKeyRange(user, from, to)))
      .filter((user) => !search[2] || pastCursor(user, cursor))
      .slice(0, Number(params.at(-1)))
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
  if (sql === "SELECT kind FROM auth_factors WHERE user_id = ? AND kind IN (SELECT value FROM json_each(?)) AND confirmed_at IS NOT NULL") {
    const found = owner();
    const kinds: unknown[] = JSON.parse(String(params[1]));
    return found
      ? factorRows(found)
          .filter((row) => kinds.includes(row.kind) && row.confirmed_at !== null)
          .map((row) => ({ kind: row.kind }))
      : [];
  }
  const resolved = SESSION_RESOLVE.exec(sql);
  if (resolved) {
    const held = params[0] instanceof Uint8Array ? ephemera.sessions.get(hex(params[0])) : undefined;
    const found = held === undefined ? undefined : users.find((user) => hex(uuidToBytes(user.id)) === held.userKey);
    if (held === undefined || found === undefined || held.expiresAt <= Number(params[1]) || (found.deactivatedAt ?? null) !== null) return [];
    if (resolved[1] !== undefined && held.lastSeenAt <= Number(params[2])) return [];
    return [
      {
        id: uuidToBytes(found.id),
        email: found.email,
        is_admin: found.isAdmin ? 1 : 0,
        session_id: held.id,
        signed_in_at: held.signedInAt,
        expires_at: held.expiresAt,
        step_up_at: held.stepUpAt,
        step_up_kind: held.stepUpKind,
        last_seen_at: held.lastSeenAt,
        device: held.device,
      },
    ];
  }
  const listedSessions = SESSION_LIST.exec(sql);
  if (listedSessions) {
    const at = Number(params[1]);
    const seenAfter = listedSessions[1] === undefined ? null : Number(params[2]);
    return [...ephemera.sessions.values()]
      .filter((seed) => seed.userKey === keyOf(params[0]) && seed.expiresAt > at && (seenAfter === null || seed.lastSeenAt > seenAfter))
      .sort((left, right) => right.signedInAt - left.signedInAt || (hex(left.id) < hex(right.id) ? 1 : -1))
      .slice(0, Number(params.at(-1)))
      .map((seed) => ({
        session_id: seed.id,
        signed_in_at: seed.signedInAt,
        expires_at: seed.expiresAt,
        step_up_at: seed.stepUpAt,
        step_up_kind: seed.stepUpKind,
        last_seen_at: seed.lastSeenAt,
        device: seed.device,
      }));
  }
  if (
    sql ===
    "DELETE FROM auth_sessions WHERE rowid IN (SELECT rowid FROM auth_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT ?) RETURNING rowid"
  ) {
    const doomed = new Set(
      [...ephemera.sessions]
        .filter(([, seed]) => seed.expiresAt <= Number(params[0]))
        .sort(([, left], [, right]) => left.expiresAt - right.expiresAt)
        .slice(0, Number(params[1]))
        .map(([key]) => key),
    );
    return Array.from({ length: dropSessions(ephemera, (key) => doomed.has(key)) }, (_, index) => ({ rowid: index + 1 }));
  }
  if (
    sql ===
    "DELETE FROM auth_challenges WHERE rowid IN (SELECT rowid FROM auth_challenges WHERE expires_at <= ? ORDER BY expires_at LIMIT ?) RETURNING rowid"
  ) {
    const doomed = [...ephemera.challenges]
      .filter(([, held]) => held.expiresAt <= Number(params[0]))
      .sort(([, left], [, right]) => left.expiresAt - right.expiresAt)
      .slice(0, Number(params[1]))
      .map(([key]) => key);
    for (const key of doomed) ephemera.challenges.delete(key);
    return doomed.map((_, index) => ({ rowid: index + 1 }));
  }
  if (
    sql ===
    "DELETE FROM auth_security_events WHERE rowid IN (SELECT rowid FROM auth_security_events WHERE at <= ? ORDER BY at LIMIT ?) RETURNING rowid"
  ) {
    const doomed = new Set(
      ephemera.events
        .filter((event) => Number(event.at) <= Number(params[0]))
        .sort((left, right) => Number(left.at) - Number(right.at))
        .slice(0, Number(params[1])),
    );
    ephemera.events.splice(0, ephemera.events.length, ...ephemera.events.filter((event) => !doomed.has(event)));
    return [...doomed].map((_, index) => ({ rowid: index + 1 }));
  }
  if (
    sql ===
    "DELETE FROM auth_users WHERE rowid IN (SELECT rowid FROM auth_users WHERE email_verified_at IS NULL AND created_at <= ? ORDER BY created_at LIMIT ?) RETURNING rowid"
  ) {
    const doomed = users
      .filter((user) => user.emailVerifiedAt === null && (user.createdAt ?? EPOCH) <= Number(params[0]))
      .sort((left, right) => (left.createdAt ?? EPOCH) - (right.createdAt ?? EPOCH))
      .slice(0, Number(params[1]))
      .map((user) => hex(uuidToBytes(user.id)));
    for (const key of doomed) removeAccount(ephemera, key);
    return doomed.map((_, index) => ({ rowid: index + 1 }));
  }
  if (
    sql ===
    "SELECT (SELECT COUNT(*) FROM auth_users WHERE id = ?) AS present, (SELECT COUNT(*) FROM auth_users WHERE id = ? AND (is_admin = 0 OR deactivated_at IS NOT NULL OR (SELECT COUNT(*) FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL) > 1)) AS deletable"
  ) {
    const key = keyOf(params[0]);
    return [{ present: users.some((user) => hex(uuidToBytes(user.id)) === key) ? 1 : 0, deletable: removableOwner(users, key) ? 1 : 0 }];
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

/** Deletes every session row `doomed` picks, answering how many went. */
function dropSessions(ephemera: AuthEphemera, doomed: (key: string, seed: SessionSeed) => boolean): number {
  const keys = [...ephemera.sessions].filter(([key, seed]) => doomed(key, seed)).map(([key]) => key);
  for (const key of keys) ephemera.sessions.delete(key);
  return keys.length;
}

function keyOf(value: unknown): string | null {
  return value instanceof Uint8Array ? hex(value) : null;
}

/** Whether the seeded account `key` names passes `NOT_LAST_ADMIN` — present, and not the last admin who could sign in. */
function removableOwner(users: readonly FakeAuthUser[], key: string | null): boolean {
  const found = users.find((user) => hex(uuidToBytes(user.id)) === key);
  if (found === undefined) return false;
  const activeAdmins = users.filter((user) => user.isAdmin === true && (user.deactivatedAt ?? null) === null).length;
  return found.isAdmin !== true || (found.deactivatedAt ?? null) !== null || activeAdmins > 1;
}

/** The rows one `auth_users` deactivation, reactivation, deletion or email-change claim reports written, or `null` when this fake models no such statement. */
function writeAccount(users: readonly FakeAuthUser[], ephemera: AuthEphemera, sql: string, params: readonly unknown[]): number | null {
  if (
    sql ===
    "UPDATE auth_users SET email_change_requested_at = ? WHERE id = ? AND (email_change_requested_at IS NULL OR email_change_requested_at <= ?)"
  ) {
    const key = keyOf(params[1]);
    const last = key === null ? undefined : ephemera.emailChanges.get(key);
    if (key === null || !users.some((user) => hex(uuidToBytes(user.id)) === key) || (last !== undefined && last > Number(params[2]))) return 0;
    ephemera.emailChanges.set(key, Number(params[0]));
    return 1;
  }
  if (
    sql ===
    "UPDATE auth_users SET deactivated_at = ?, updated_at = ? WHERE id = ? AND deactivated_at IS NULL AND (is_admin = 0 OR deactivated_at IS NOT NULL OR (SELECT COUNT(*) FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL) > 1)"
  ) {
    const key = keyOf(params[2]);
    const active = users.some((user) => hex(uuidToBytes(user.id)) === key && (user.deactivatedAt ?? null) === null);
    if (key === null || !active || !removableOwner(users, key)) return 0;
    ephemera.accounts.set(key, { deactivatedAt: Number(params[0]), updatedAt: Number(params[1]) });
    return 1;
  }
  if (sql === "UPDATE auth_users SET deactivated_at = NULL, updated_at = ? WHERE id = ? AND deactivated_at IS NOT NULL") {
    const key = keyOf(params[1]);
    if (key === null || !users.some((user) => hex(uuidToBytes(user.id)) === key && (user.deactivatedAt ?? null) !== null)) return 0;
    ephemera.accounts.set(key, { deactivatedAt: null, updatedAt: Number(params[0]) });
    return 1;
  }
  if (
    sql ===
    "DELETE FROM auth_users WHERE id = ? AND (is_admin = 0 OR deactivated_at IS NOT NULL OR (SELECT COUNT(*) FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL) > 1)"
  ) {
    const key = keyOf(params[0]);
    if (key === null || !removableOwner(users, key)) return 0;
    removeAccount(ephemera, key);
    return 1;
  }
  return null;
}

/** Removes the account `key` names, with the session and security event rows its deletion cascades to. */
function removeAccount(ephemera: AuthEphemera, key: string): void {
  ephemera.removed.add(key);
  dropSessions(ephemera, (_key, seed) => seed.userKey === key);
  ephemera.events.splice(0, ephemera.events.length, ...ephemera.events.filter((event) => keyOf(event.user_id) !== key));
}

/** The seeded accounts as the deactivations, reactivations and deletions written so far leave them. */
function accountsOf(users: readonly FakeAuthUser[], ephemera: AuthEphemera): readonly FakeAuthUser[] {
  if (ephemera.accounts.size === 0 && ephemera.removed.size === 0) return users;
  return users
    .filter((user) => !ephemera.removed.has(hex(uuidToBytes(user.id))))
    .map((user) => {
      const written = ephemera.accounts.get(hex(uuidToBytes(user.id)));
      return written === undefined ? user : { ...user, ...written };
    });
}

/** The rows one `auth_sessions` write reports written, or `null` when this fake models no such statement. */
function writeSession(users: readonly FakeAuthUser[], ephemera: AuthEphemera, sql: string, params: readonly unknown[]): number | null {
  const owner = keyOf(params[0]);
  if (
    sql ===
    "INSERT INTO auth_sessions (token_hash, user_id, signed_in_at, expires_at, step_up_at, id, step_up_kind, last_seen_at, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ) {
    const key = keyOf(params[0]);
    const userKey = keyOf(params[1]);
    const id = params[5];
    if (key === null || userKey === null || !(id instanceof Uint8Array)) return null;
    const stepUpAt = params[4] === null ? null : Number(params[4]);
    const stepUpKind = params[6] === null ? null : String(params[6]);
    ephemera.sessions.set(key, {
      userKey,
      signedInAt: Number(params[2]),
      expiresAt: Number(params[3]),
      stepUpAt,
      id,
      stepUpKind,
      lastSeenAt: Number(params[7]),
      device: params[8] === null ? null : String(params[8]),
    });
    return 1;
  }
  if (sql === "UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ? AND last_seen_at <= ?") {
    const key = keyOf(params[1]);
    const held = key === null ? undefined : ephemera.sessions.get(key);
    if (key === null || held === undefined || held.lastSeenAt > Number(params[2])) return 0;
    ephemera.sessions.set(key, { ...held, lastSeenAt: Number(params[0]) });
    return 1;
  }
  const rotation = /^UPDATE auth_sessions SET token_hash = \?(, step_up_at = \?, step_up_kind = \?)? WHERE token_hash = \?$/.exec(sql);
  if (rotation) {
    const stamped = rotation[1] !== undefined;
    const key = keyOf(params[0]);
    const replaced = keyOf(params[stamped ? 3 : 1]);
    const held = replaced === null ? undefined : ephemera.sessions.get(replaced);
    if (key === null || replaced === null || held === undefined) return 0;
    ephemera.sessions.delete(replaced);
    ephemera.sessions.set(key, stamped ? { ...held, stepUpAt: Number(params[1]), stepUpKind: String(params[2]) } : held);
    return 1;
  }
  if (sql === "DELETE FROM auth_sessions WHERE token_hash = ?") return dropSessions(ephemera, (key) => key === owner);
  const revocation = SESSION_REVOCATION.exec(sql);
  if (revocation) {
    const [, spared, guarded, guard] = revocation;
    const keep = spared === undefined ? null : keyOf(params[1]);
    const byId = guard === "id = ?";
    const id = byId ? keyOf(params.at(-1)) : null;
    if ((byId && id === null) || (guarded !== undefined && !byId && ephemera.changes === 0)) return 0;
    return dropSessions(ephemera, (key, seed) => seed.userKey === owner && key !== keep && (!byId || hex(seed.id) === id));
  }
  if (
    sql === "DELETE FROM auth_sessions WHERE user_id = ? AND user_id IN (SELECT id FROM auth_users WHERE id = ? AND deactivated_at IS NOT NULL)"
  ) {
    const deactivated = users.some((user) => hex(uuidToBytes(user.id)) === owner && (user.deactivatedAt ?? null) !== null);
    return deactivated ? dropSessions(ephemera, (_key, seed) => seed.userKey === owner) : 0;
  }
  return null;
}

/** The rows one `auth_security_events` insert reports written, or `null` when this fake models no such statement or cannot decide its guard. */
function writeSecurityEvent(ephemera: AuthEphemera, sql: string, params: readonly unknown[]): number | null {
  const matched = SECURITY_EVENT_INSERT.exec(sql);
  if (!matched) return null;
  const [, user = "", session = "", guard = ""] = matched;
  if (guard !== "1" && ephemera.changes === 0) return 0;
  const values = [...params];
  const id = values.shift();
  const userKey = user === "?" ? values.shift() : ephemera.sessions.get(keyOf(values.shift()) ?? "")?.userKey;
  const [type, factorKind] = [values.shift(), values.shift()];
  const sessionId = session === "NULL" ? null : (ephemera.sessions.get(keyOf(values.shift()) ?? "")?.id ?? null);
  const [adminId, at] = [values.shift(), values.shift()];
  if (userKey === undefined) return 0;
  ephemera.events.push({
    id,
    user_id: typeof userKey === "string" ? unhex(userKey) : userKey,
    type,
    factor_kind: factorKind,
    session_id: sessionId,
    admin_id: adminId,
    at,
  });
  return 1;
}

/** The rows one ephemeral write reports written, or `null` when this fake models no such statement. */
function write(users: readonly FakeAuthUser[], ephemera: AuthEphemera, sql: string, params: readonly unknown[]): number | null {
  const account = writeAccount(users, ephemera, sql, params);
  if (account !== null) return account;
  const session = writeSession(users, ephemera, sql, params);
  if (session !== null) return session;
  const event = writeSecurityEvent(ephemera, sql, params);
  if (event !== null) return event;
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

/** A `fakeD1` that answers forge's auth stores from accounts stated in domain terms, holding the challenge, nonce, session and security event rows and the deactivations, deletions and email-change claims it is written. @public */
export function fakeAuthD1(
  users: readonly FakeAuthUser[],
  options?: FakeD1Options,
): D1DatabaseLike & { calls: { sql: string; params: unknown[] }[] } {
  const ephemera: AuthEphemera = {
    challenges: new Map(),
    nonces: new Set(),
    sessions: new Map(),
    events: [],
    changes: 0,
    accounts: new Map(),
    removed: new Set(),
    emailChanges: new Map(),
  };
  // An unmodelled SELECT answers no rows rather than throwing: every store reads "no rows" as the
  // absence it is, not as a failure it cannot describe.
  return fakeD1((sql, params) => firstRowOf(squash(sql), (statement) => respond(accountsOf(users, ephemera), ephemera, statement, params) ?? []), {
    ...options,
    rowsWritten: (sql, params) => {
      const written = options?.rowsWritten?.(sql, params) ?? write(accountsOf(users, ephemera), ephemera, squash(sql), params);
      if (D1_WRITE.test(squash(sql))) ephemera.changes = written ?? 0;
      return written;
    },
  });
}
