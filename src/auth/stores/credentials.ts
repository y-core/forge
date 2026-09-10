import { uuidFromBytes, uuidv7Bytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { CredentialStore } from "../types";
import { readCredential, readMaybe, readRow, storeError, unknownOwner, uuidKey } from "./rows";
import type { CredentialRow } from "./types";

/** Creates the `CredentialStore` over a SQL database — every write scoped to the credential's owner. @public */
export function createCredentialStore(db: D1Client): CredentialStore {
  return {
    async listByUser(userId) {
      const key = uuidKey(userId);
      if (!key) return ok([]);
      const outcome = await db.query<CredentialRow>(sql`SELECT * FROM auth_credentials WHERE user_id = ${key} ORDER BY id`);
      return outcome.ok
        ? readRow("credentials.listByUser", () => outcome.data.map(readCredential))
        : err(storeError("credentials.listByUser", outcome.error));
    },

    async findByCredentialId(credentialId) {
      const outcome = await db.queryOne<CredentialRow>(sql`SELECT * FROM auth_credentials WHERE credential_id = ${credentialId}`);
      return outcome.ok
        ? readMaybe("credentials.findByCredentialId", outcome.data, readCredential)
        : err(storeError("credentials.findByCredentialId", outcome.error));
    },

    async create(input, at) {
      const owner = uuidKey(input.userId);
      if (!owner) return err(unknownOwner("credentials.create"));
      const idBytes = uuidv7Bytes();
      const transports = input.transports ?? [];
      const outcome = await db.execute(
        sql`INSERT INTO auth_credentials (id, user_id, credential_id, public_key, algorithm, sign_count, transports, backup_eligible, backed_up, label, last_used_at, created_at, updated_at)
            VALUES (${idBytes}, ${owner}, ${input.credentialId}, ${input.publicKey}, ${input.algorithm}, ${input.signCount},
                    ${JSON.stringify(transports)}, ${input.backupEligible ? 1 : 0}, ${input.backedUp ? 1 : 0}, ${input.label ?? null}, ${null}, ${at}, ${at})`,
      );
      if (!outcome.ok) return err(storeError("credentials.create", outcome.error));
      return ok({
        id: uuidFromBytes(idBytes),
        userId: input.userId,
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        algorithm: input.algorithm,
        signCount: input.signCount,
        transports,
        backupEligible: input.backupEligible ?? false,
        backedUp: input.backedUp ?? false,
        label: input.label ?? null,
        lastUsedAt: null,
        createdAt: at,
        updatedAt: at,
      });
    },

    async recordUse(id, signCount, backedUp, at) {
      // The counter rule is the statement's, not the caller's: comparing in JS and writing after is
      // a read followed by a write, and a captured assertion replayed between the two lands twice.
      const key = uuidKey(id);
      if (!key) return ok(false);
      const outcome = await db.execute(
        sql`UPDATE auth_credentials SET sign_count = ${signCount}, backed_up = ${backedUp ? 1 : 0}, last_used_at = ${at}, updated_at = ${at}
            WHERE id = ${key} AND (sign_count < ${signCount} OR (sign_count = 0 AND ${signCount} = 0))`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("credentials.recordUse", outcome.error));
    },

    async relabel(id, userId, label, at) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const outcome = await db.execute(
        sql`UPDATE auth_credentials SET label = ${label}, updated_at = ${at}
            WHERE id = ${key} AND user_id = ${owner}`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("credentials.relabel", outcome.error));
    },

    async removeForUser(id, userId) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const outcome = await db.execute(sql`DELETE FROM auth_credentials WHERE id = ${key} AND user_id = ${owner}`);
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("credentials.removeForUser", outcome.error));
    },
  };
}
