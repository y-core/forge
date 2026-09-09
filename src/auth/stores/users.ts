import { uuidv7Bytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { UserStore } from "../types";
import { readMaybe, readUser, storeError, type UserRow, uuidKey } from "./rows";

/** Creates the `UserStore` over a SQL database — reads and writes, with no capability to delete a user. @public */
export function createUserStore(db: D1Client): UserStore {
  return {
    async findById(id) {
      const key = uuidKey(id);
      if (!key) return ok(null);
      const outcome = await db.queryOne<UserRow>(sql`SELECT * FROM auth_users WHERE id = ${key}`);
      return outcome.ok ? readMaybe("users.findById", outcome.data, readUser) : err(storeError("users.findById", outcome.error));
    },

    async findByEmailKey(emailKey) {
      const outcome = await db.queryOne<UserRow>(sql`SELECT * FROM auth_users WHERE email_key = ${emailKey}`);
      return outcome.ok ? readMaybe("users.findByEmailKey", outcome.data, readUser) : err(storeError("users.findByEmailKey", outcome.error));
    },

    async findByWebAuthnId(webauthnId) {
      const outcome = await db.queryOne<UserRow>(sql`SELECT * FROM auth_users WHERE webauthn_id = ${webauthnId}`);
      return outcome.ok ? readMaybe("users.findByWebAuthnId", outcome.data, readUser) : err(storeError("users.findByWebAuthnId", outcome.error));
    },

    async create(input, at) {
      const idBytes = uuidv7Bytes();
      const row: UserRow = {
        id: idBytes,
        email: input.email,
        email_key: input.emailKey,
        email_verified_at: input.emailVerifiedAt ?? null,
        webauthn_id: null,
        is_admin: input.isAdmin ? 1 : 0,
        deactivated_at: null,
        created_at: at,
        updated_at: at,
      };
      const outcome = await db.execute(
        sql`INSERT INTO auth_users (id, email, email_key, email_verified_at, is_admin, created_at, updated_at)
            VALUES (${idBytes}, ${row.email}, ${row.email_key}, ${row.email_verified_at}, ${row.is_admin}, ${at}, ${at})`,
      );
      return outcome.ok ? ok(readUser(row)) : err(storeError("users.create", outcome.error));
    },

    async setWebAuthnIdIfAbsent(id, webauthnId, at) {
      const key = uuidKey(id);
      if (!key) return ok(null);
      const written = await db.execute(
        sql`UPDATE auth_users SET webauthn_id = ${webauthnId}, updated_at = ${at} WHERE id = ${key} AND webauthn_id IS NULL`,
      );
      if (!written.ok) return err(storeError("users.setWebAuthnIdIfAbsent", written.error));
      // Whichever request won, the row now carries a handle, so the read reports one rather than
      // deciding anything: a concurrent minter's handle is the answer, not a conflict.
      const found = await db.queryOne<UserRow>(sql`SELECT * FROM auth_users WHERE id = ${key}`);
      return found.ok
        ? readMaybe("users.setWebAuthnIdIfAbsent", found.data, readUser)
        : err(storeError("users.setWebAuthnIdIfAbsent", found.error));
    },

    async markEmailVerified(id, at) {
      const key = uuidKey(id);
      if (!key) return ok(false);
      const outcome = await db.execute(sql`UPDATE auth_users SET email_verified_at = ${at}, updated_at = ${at} WHERE id = ${key}`);
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("users.markEmailVerified", outcome.error));
    },

    async changeEmail(id, email, emailKey, at) {
      const key = uuidKey(id);
      if (!key) return ok(false);
      // Answering the mailed link *is* proof of control over the new address, so the statement that
      // moves the row verifies it too — a second write could fail and leave the account unverified.
      const outcome = await db.execute(
        sql`UPDATE auth_users SET email = ${email}, email_key = ${emailKey}, email_verified_at = ${at}, updated_at = ${at}
            WHERE id = ${key}`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("users.changeEmail", outcome.error));
    },
  };
}
