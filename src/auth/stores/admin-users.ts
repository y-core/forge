import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { AdminUserStore, AuthUserPage } from "../types";
import { normalizeEmail } from "./email";
import { adminRefusal, NOT_LAST_ADMIN, ownerRemovable, pageLimit, readMaybe, readRow, readUser, storeError, uuidKey } from "./rows";
import type { UserRow } from "./types";

// Prefix-anchored, so the unique index on `email_key` answers the search. A leading `%` made every
// search a full scan of the table. The product consequence is stated where a consumer reads it:
// a substring in the middle of an address no longer matches.
/** Turns a search term into a prefix `LIKE` pattern, escaping the two wildcards a caller's text may carry. */
function likeTerm(query: string): string {
  return `${normalizeEmail(query).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
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
      // Matched against `email_key`, so a search folds case exactly where the unique index does.
      const limit = pageLimit(page.limit);
      const term = likeTerm(query);
      const cursor = page.after === undefined ? null : uuidKey(page.after);
      if (page.after !== undefined && !cursor) return ok([]);
      const fragment = cursor
        ? sql`SELECT * FROM auth_users WHERE email_key LIKE ${term} ESCAPE '\\' AND id < ${cursor} ORDER BY id DESC LIMIT ${limit}`
        : sql`SELECT * FROM auth_users WHERE email_key LIKE ${term} ESCAPE '\\' ORDER BY id DESC LIMIT ${limit}`;
      const outcome = await db.query<UserRow>(fragment);
      return outcome.ok ? readRow("adminUsers.search", () => outcome.data.map(readUser)) : err(storeError("adminUsers.search", outcome.error));
    },

    async countAdmins() {
      const outcome = await db.queryOne<{ total: number }>(
        sql`SELECT COUNT(*) AS total FROM auth_users WHERE is_admin = 1 AND deactivated_at IS NULL`,
      );
      return outcome.ok ? ok(outcome.data?.total ?? 0) : err(storeError("adminUsers.countAdmins", outcome.error));
    },

    async setAdmin(id, isAdmin, at) {
      // Two concurrent demotions each reading "two admins remain" is the race this guard makes
      // unexpressible: the count is evaluated by the statement that writes, not by the caller.
      const key = uuidKey(id);
      if (!key) return ok("not-found");
      const fragment = isAdmin
        ? sql`UPDATE auth_users SET is_admin = 1, updated_at = ${at} WHERE id = ${key}`
        : sql`UPDATE auth_users SET is_admin = 0, updated_at = ${at} WHERE id = ${key} AND ${NOT_LAST_ADMIN}`;
      const written = await db.execute(fragment);
      if (!written.ok) return err(storeError("adminUsers.setAdmin", written.error));
      if (written.data.rowsWritten > 0) return ok("changed");
      return isAdmin ? ok("not-found") : adminRefusal(db, "adminUsers.setAdmin", key, "last-admin-demote");
    },

    async setDeactivated(id, deactivated, at) {
      const key = uuidKey(id);
      if (!key) return ok("not-found");
      const fragment = deactivated
        ? sql`UPDATE auth_users SET deactivated_at = ${at}, updated_at = ${at} WHERE id = ${key} AND ${NOT_LAST_ADMIN}`
        : sql`UPDATE auth_users SET deactivated_at = NULL, updated_at = ${at} WHERE id = ${key}`;
      const written = await db.execute(fragment);
      if (!written.ok) return err(storeError("adminUsers.setDeactivated", written.error));
      if (written.data.rowsWritten > 0) return ok("changed");
      return deactivated ? adminRefusal(db, "adminUsers.setDeactivated", key, "last-admin-deactivate") : ok("not-found");
    },

    async remove(id) {
      // The children go first so correctness never rests on `PRAGMA foreign_keys`, and `batch()` is
      // one transaction rolling back whole, so a half-deleted account is not a state to land in.
      const key = uuidKey(id);
      if (!key) return ok("not-found");
      const outcome = await db.batch<{ present: number; deletable: number }>([
        sql`SELECT (SELECT COUNT(*) FROM auth_users WHERE id = ${key}) AS present,
                   (SELECT COUNT(*) FROM auth_users WHERE id = ${key} AND ${NOT_LAST_ADMIN}) AS deletable`,
        sql`DELETE FROM auth_credentials WHERE user_id = ${key} AND ${ownerRemovable(key)}`,
        sql`DELETE FROM auth_factors WHERE user_id = ${key} AND ${ownerRemovable(key)}`,
        sql`DELETE FROM auth_identity_links WHERE user_id = ${key} AND ${ownerRemovable(key)}`,
        sql`DELETE FROM auth_otp_state WHERE user_id = ${key} AND ${ownerRemovable(key)}`,
        sql`DELETE FROM auth_users WHERE id = ${key} AND ${NOT_LAST_ADMIN}`,
      ]);
      if (!outcome.ok) return err(storeError("adminUsers.remove", outcome.error));
      const probe = outcome.data[0]?.results[0];
      if (probe === undefined || probe.present === 0) return ok("not-found");
      if (probe.deletable === 0) return ok("last-admin-delete");
      // The probe only names the refusal; the DELETE is what decides. Disagreeing with it inside one
      // transaction is a backend the caller cannot reason about, so it is reported as such.
      const meta = outcome.data.at(-1)?.meta;
      const removed = meta?.rows_written ?? meta?.changes ?? 0;
      return removed > 0 ? ok("changed") : err(storeError("adminUsers.remove", "the guarded delete matched the probe but removed no row"));
    },
  };
}
