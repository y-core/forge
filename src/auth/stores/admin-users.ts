import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client, SqlFragment } from "../../storage/db/types";
import type { AdminUserOutcome, AdminUserStore, AuthStoreResult, AuthUserPage } from "../types";
import { normalizeEmail } from "./email";
import { authSecurityEventStatement } from "./events";
import {
  adminRefusal,
  isAppKeyDeleteRefusal,
  NO_ADMIN_YET,
  NOT_LAST_ADMIN,
  pageLimit,
  readMaybe,
  readRow,
  readUser,
  storeError,
  uuidKey,
} from "./rows";
import { authSessionRevocation, authSessionRotation } from "./sessions";
import type { UserRow } from "./types";

/** The least string above every string starting with `prefix`, or `null` when no string is. @internal */
function upperBound(prefix: string): string | null {
  const points = Array.from(prefix, (char) => char.codePointAt(0) ?? 0);
  while (points.length > 0) {
    const last = points.pop() ?? 0;
    if (last < 0x10ffff) return String.fromCodePoint(...points, last === 0xd7ff ? 0xe000 : last + 1);
  }
  return null;
}

/** Names why a state write changed nothing, reading the row only once it has declined: no such account, one where `held` already holds, or `refused`. */
async function stateRefusal(
  db: D1Client,
  operation: string,
  key: Uint8Array<ArrayBuffer>,
  held: SqlFragment,
  refused: AdminUserOutcome,
): Promise<AuthStoreResult<AdminUserOutcome>> {
  const found = await db.queryOne<{ held: number }>(sql`SELECT (${held}) AS held FROM auth_users WHERE id = ${key}`);
  if (!found.ok) return err(storeError(operation, found.error));
  if (!found.data) return ok("not-found");
  return ok(found.data.held === 1 ? "unchanged" : refused);
}

/** Creates the `AdminUserStore` over a SQL database — the surface that lists, searches, elevates, deactivates and deletes. @public */
export function createAdminUserStore(db: D1Client): AdminUserStore {
  return {
    async findById(id) {
      const key = uuidKey(id);
      if (!key) return ok(null);
      const outcome = await db.queryOne<UserRow>(sql`SELECT * FROM auth_users WHERE id = ${key}`);
      return outcome.ok ? readMaybe("adminUsers.findById", outcome.data, readUser) : err(storeError("adminUsers.findById", outcome.error));
    },

    async list(page: AuthUserPage = {}) {
      // Bytewise order on a UUIDv7 primary key *is* time order, so the cursor is the key itself and
      // no `created_at` index has to exist for a newest-first page to be cheap.
      const limit = pageLimit(page.limit);
      const cursor = page.after === undefined ? null : uuidKey(page.after);
      if (page.after !== undefined && !cursor) return ok([]);
      const fragment = cursor
        ? sql`SELECT * FROM auth_users WHERE id < ${cursor} ORDER BY id DESC LIMIT ${limit}`
        : sql`SELECT * FROM auth_users ORDER BY id DESC LIMIT ${limit}`;
      const outcome = await db.query<UserRow>(fragment);
      return outcome.ok ? readRow("adminUsers.list", () => outcome.data.map(readUser)) : err(storeError("adminUsers.list", outcome.error));
    },

    async search(query, page: AuthUserPage = {}) {
      const limit = pageLimit(page.limit);
      const from = normalizeEmail(query);
      const to = upperBound(from);
      const cursor = page.after === undefined ? null : uuidKey(page.after);
      if (page.after !== undefined && !cursor) return ok([]);
      const range = to === null ? sql`email_key >= ${from}` : sql`email_key >= ${from} AND email_key < ${to}`;
      const fragment = cursor
        ? sql`SELECT * FROM auth_users WHERE ${range} AND id < ${cursor} ORDER BY id DESC LIMIT ${limit}`
        : sql`SELECT * FROM auth_users WHERE ${range} ORDER BY id DESC LIMIT ${limit}`;
      const outcome = await db.query<UserRow>(fragment);
      return outcome.ok ? readRow("adminUsers.search", () => outcome.data.map(readUser)) : err(storeError("adminUsers.search", outcome.error));
    },

    async countAdmins() {
      const outcome = await db.queryOne<{ total: number }>(
        sql`SELECT COUNT(*) AS total FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL`,
      );
      return outcome.ok ? ok(outcome.data?.total ?? 0) : err(storeError("adminUsers.countAdmins", outcome.error));
    },

    // One batch, so a failed rotation takes the claim down with it. The rotation's `changes()` reads the
    // event insert, which lands only with the claim: a statement put between them rotates a refused claim.
    async claimFirstAdmin(id, at, rotation) {
      const key = uuidKey(id);
      if (!key) return ok("not-found");
      const written = await db.batch([
        sql`UPDATE auth_users SET is_admin = 1, updated_at = ${at} WHERE id = ${key} AND ${NO_ADMIN_YET}`,
        authSecurityEventStatement(
          { userKey: key, type: "admin-granted", factorKind: null, keep: rotation?.replaces ?? null, adminKey: key, at },
          sql`changes() > 0`,
        ),
        ...(rotation === undefined ? [] : authSessionRotation(rotation, undefined, sql` AND changes() > 0`)),
      ]);
      if (!written.ok) return err(storeError("adminUsers.claimFirstAdmin", written.error));
      if ((written.data[0]?.rowsWritten ?? 0) > 0) return ok("changed");
      return adminRefusal(db, "adminUsers.claimFirstAdmin", key, "admin-exists");
    },

    // Each role and status UPDATE matches only a row not already in the asked-for state, so the
    // `changes()` directly after it records an event for a change that happened and none for a no-op.
    async setAdmin(id, isAdmin, at, adminId) {
      // Two concurrent demotions each reading "two admins remain" is the race this guard makes
      // unexpressible: the count is evaluated by the statement that writes, not by the caller.
      const key = uuidKey(id);
      const admin = uuidKey(adminId);
      if (!key || !admin) return ok("not-found");
      const fragment = isAdmin
        ? sql`UPDATE auth_users SET is_admin = 1, updated_at = ${at} WHERE id = ${key} AND is_admin = 0`
        : sql`UPDATE auth_users SET is_admin = 0, updated_at = ${at} WHERE id = ${key} AND is_admin = 1 AND ${NOT_LAST_ADMIN}`;
      const written = await db.batch([
        fragment,
        authSecurityEventStatement(
          { userKey: key, type: isAdmin ? "admin-granted" : "admin-revoked", factorKind: null, keep: null, adminKey: admin, at },
          sql`changes() > 0`,
        ),
      ]);
      if (!written.ok) return err(storeError("adminUsers.setAdmin", written.error));
      if ((written.data[0]?.rowsWritten ?? 0) > 0) return ok("changed");
      return isAdmin
        ? stateRefusal(db, "adminUsers.setAdmin", key, sql`is_admin = 1`, "unchanged")
        : stateRefusal(db, "adminUsers.setAdmin", key, sql`is_admin = 0`, "last-admin-demote");
    },

    async setDeactivated(id, deactivated, at, adminId) {
      const key = uuidKey(id);
      const admin = uuidKey(adminId);
      if (!key || !admin) return ok("not-found");
      const event = authSecurityEventStatement(
        { userKey: key, type: deactivated ? "account-deactivated" : "account-reactivated", factorKind: null, keep: null, adminKey: admin, at },
        sql`changes() > 0`,
      );
      if (!deactivated) {
        const written = await db.batch([
          sql`UPDATE auth_users SET deactivated_at = NULL, updated_at = ${at} WHERE id = ${key} AND deactivated_at IS NOT NULL`,
          event,
        ]);
        if (!written.ok) return err(storeError("adminUsers.setDeactivated", written.error));
        if ((written.data[0]?.rowsWritten ?? 0) > 0) return ok("changed");
        return stateRefusal(db, "adminUsers.setDeactivated", key, sql`deactivated_at IS NULL`, "unchanged");
      }
      const outcome = await db.batch([
        sql`UPDATE auth_users SET deactivated_at = ${at}, updated_at = ${at} WHERE id = ${key} AND deactivated_at IS NULL AND ${NOT_LAST_ADMIN}`,
        event,
        authSessionRevocation(key, null, sql`user_id IN (SELECT id FROM auth_users WHERE id = ${key} AND deactivated_at IS NOT NULL)`),
      ]);
      if (!outcome.ok) return err(storeError("adminUsers.setDeactivated", outcome.error));
      if ((outcome.data[0]?.rowsWritten ?? 0) > 0) return ok("changed");
      return stateRefusal(db, "adminUsers.setDeactivated", key, sql`deactivated_at IS NOT NULL`, "last-admin-deactivate");
    },

    async remove(id) {
      const key = uuidKey(id);
      if (!key) return ok("not-found");
      const outcome = await db.batch<{ present: number; deletable: number }>([
        sql`SELECT (SELECT COUNT(*) FROM auth_users WHERE id = ${key}) AS present,
                   (SELECT COUNT(*) FROM auth_users WHERE id = ${key} AND ${NOT_LAST_ADMIN}) AS deletable`,
        sql`DELETE FROM auth_users WHERE id = ${key} AND ${NOT_LAST_ADMIN}`,
      ]);
      if (!outcome.ok) return isAppKeyDeleteRefusal(outcome.error) ? ok("referenced") : err(storeError("adminUsers.remove", outcome.error));
      const probe = outcome.data[0]?.results[0];
      if (probe === undefined || probe.present === 0) return ok("not-found");
      if (probe.deletable === 0) return ok("last-admin-delete");
      // The probe only names the refusal; the DELETE is what decides. Disagreeing with it inside one
      // transaction is a backend the caller cannot reason about, so it is reported as such.
      const removed = outcome.data.at(-1)?.rowsWritten ?? 0;
      return removed > 0 ? ok("changed") : err(storeError("adminUsers.remove", "the guarded delete matched the probe but removed no row"));
    },

    async resetFactors(id, at, adminId) {
      const key = uuidKey(id);
      const admin = uuidKey(adminId);
      if (!key || !admin) return ok("not-found");
      const outcome = await db.batch<{ present: number }>([
        sql`SELECT COUNT(*) AS present FROM auth_users WHERE id = ${key}`,
        authSecurityEventStatement(
          { userKey: key, type: "factors-reset", factorKind: null, keep: null, adminKey: admin, at },
          sql`EXISTS (SELECT 1 FROM auth_users WHERE id = ${key})`,
        ),
        sql`DELETE FROM auth_credentials WHERE user_id = ${key}`,
        sql`DELETE FROM auth_factors WHERE user_id = ${key}`,
        sql`DELETE FROM auth_recovery_codes WHERE user_id = ${key}`,
        sql`UPDATE auth_access_tokens SET revoked_at = ${at} WHERE user_id = ${key} AND revoked_at IS NULL`,
        authSessionRevocation(key, null),
      ]);
      if (!outcome.ok) return err(storeError("adminUsers.resetFactors", outcome.error));
      const probe = outcome.data[0]?.results[0];
      return probe === undefined || probe.present === 0 ? ok("not-found") : ok("changed");
    },
  };
}
