import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import { uuidFromBytes, uuidv7Bytes } from "../../storage/db/uuid";
import type { CredentialStore } from "../types";
import { authSecurityEventStatement } from "./events";
import { authFactorRemovalOutcome, authRecoveryCascade, authSecondFactorRemains } from "./factors";
import { readCredential, readMaybe, readRow, storeError, unknownOwner, uuidKey } from "./rows";
import { authSessionRevocation } from "./sessions";
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

    async create(input, at, origin) {
      const owner = uuidKey(input.userId);
      if (!owner) return err(unknownOwner("credentials.create"));
      const idBytes = uuidv7Bytes();
      const transports = input.transports ?? [];
      const outcome = await db.batch([
        sql`INSERT INTO auth_credentials (id, user_id, credential_id, public_key, algorithm, sign_count, transports, backup_eligible, backed_up, label, last_used_at, created_at, updated_at)
            VALUES (${idBytes}, ${owner}, ${input.credentialId}, ${input.publicKey}, ${input.algorithm}, ${input.signCount},
                    ${JSON.stringify(transports)}, ${input.backupEligible ? 1 : 0}, ${input.backedUp ? 1 : 0}, ${input.label ?? null}, ${null}, ${at}, ${at})`,
        authSecurityEventStatement({ userKey: owner, type: "factor-added", factorKind: "passkey", keep: origin.keep, adminKey: null, at }),
        authSessionRevocation(owner, origin.keep),
      ]);
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
      // a read followed by a write, and a captured assertion replayed between them lands twice.
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

    // One batch, so a failed revoke leaves the credential for a retry to find. The sessions and the
    // event go first because their guard reads the credential row the later delete removes.
    async removeForUser(id, userId, at, origin, floor) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok("not-found");
      const target = sql`id = ${key} AND user_id = ${owner}`;
      const lastPasskey = sql`kind = ${"passkey"} AND NOT EXISTS (SELECT 1 FROM auth_credentials WHERE user_id = ${owner} AND id != ${key})`;
      const removable = authSecondFactorRemains(owner, floor, lastPasskey);
      const held = sql`EXISTS (SELECT 1 FROM auth_credentials WHERE ${target}) AND ${removable}`;
      const outcome = await db.batch<{ present: number; removable: number }>([
        sql`SELECT (SELECT COUNT(*) FROM auth_credentials WHERE ${target}) AS present, ${removable} AS removable`,
        authSessionRevocation(owner, origin.keep, held),
        authSecurityEventStatement({ userKey: owner, type: "factor-removed", factorKind: "passkey", keep: origin.keep, adminKey: null, at }, held),
        sql`DELETE FROM auth_credentials WHERE ${target} AND ${removable}`,
        sql`DELETE FROM auth_factors WHERE user_id = ${owner} AND kind = ${"passkey"}
            AND NOT EXISTS (SELECT 1 FROM auth_credentials WHERE user_id = ${owner})`,
        ...authRecoveryCascade(owner),
      ]);
      if (!outcome.ok) return err(storeError("credentials.removeForUser", outcome.error));
      return authFactorRemovalOutcome("credentials.removeForUser", outcome.data[0]?.results[0], outcome.data[3]?.rowsWritten ?? 0);
    },
  };
}
