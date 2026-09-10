import { uuidToBytes } from "../crypto/mod";
import type { D1DatabaseLike } from "../storage/db/types";
import { fakeD1 } from "./fakes";
import type { FakeD1Options } from "./types";
import type { FakeAuthUser } from "./types";

const EPOCH = 1;

/** A valid UUID for a factor row the caller did not name one for. */
function derivedId(index: number): string {
  return `00000000-0000-7000-8000-${String(index).padStart(12, "0")}`;
}

function sameBytes(left: unknown, right: Uint8Array | null | undefined): boolean {
  if (!(left instanceof Uint8Array) || right == null || left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
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
    confirmed_at: factor.confirmedAt === undefined ? EPOCH : factor.confirmedAt,
    created_at: EPOCH,
    updated_at: EPOCH,
  }));
}

// Matched on the whole statement rather than a substring: the auth stores issue a fixed set, and a
// near-miss answering the wrong rows is worse for a consumer than answering none.
/** The rows one statement selects, or `null` when this fake models no such statement. */
function respond(users: readonly FakeAuthUser[], sql: string, params: readonly unknown[]): Record<string, unknown>[] | null {
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
  return null;
}

// The single largest piece of guesswork in testing a consumer's auth mount was the column names and
// the UUID-as-BLOB binding; this answers the stores' own statements so neither has to be re-derived.
/** A `fakeD1` that answers forge's auth stores from accounts stated in domain terms. @public */
export function fakeAuthD1(
  users: readonly FakeAuthUser[],
  options?: FakeD1Options,
): D1DatabaseLike & { calls: { sql: string; params: unknown[] }[] } {
  // An unmodelled SELECT answers no rows rather than throwing: a write never reaches this responder,
  // and every store reads "no rows" as the absence it is, not as a failure it cannot describe.
  return fakeD1((sql, params) => respond(users, sql, params) ?? [], options);
}
