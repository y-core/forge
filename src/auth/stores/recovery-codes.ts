import { uuidv7Bytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { RecoveryCodeStore } from "../types";
import { storeError, unknownOwner, uuidKey } from "./rows";

/** Creates the `RecoveryCodeStore` over a SQL database — codes held only as their SHA-256, matched within their owner. @public */
export function createRecoveryCodeStore(db: D1Client): RecoveryCodeStore {
  return {
    async stage(userId, hashes, at) {
      const owner = uuidKey(userId);
      if (!owner) return err(unknownOwner("recoveryCodes.stage"));
      const outcome = await db.batch([
        sql`DELETE FROM auth_recovery_codes WHERE user_id = ${owner} AND staged = 1`,
        ...hashes.map(
          (hash) =>
            sql`INSERT INTO auth_recovery_codes (id, user_id, code_hash, staged, used_at, created_at)
                VALUES (${uuidv7Bytes()}, ${owner}, ${hash}, 1, ${null}, ${at})`,
        ),
      ]);
      return outcome.ok ? ok(undefined) : err(storeError("recoveryCodes.stage", outcome.error));
    },

    async holdsStaged(userId, hash) {
      const owner = uuidKey(userId);
      if (!owner) return ok(false);
      const outcome = await db.queryOne<{ held: number }>(
        sql`SELECT 1 AS held FROM auth_recovery_codes WHERE user_id = ${owner} AND code_hash = ${hash} AND staged = 1`,
      );
      return outcome.ok ? ok(outcome.data !== null && outcome.data !== undefined) : err(storeError("recoveryCodes.holdsStaged", outcome.error));
    },

    async commit(userId, factorId, at) {
      const owner = uuidKey(userId);
      const key = uuidKey(factorId);
      if (!owner || !key) return err(unknownOwner("recoveryCodes.commit"));
      const outcome = await db.batch([
        sql`DELETE FROM auth_recovery_codes WHERE user_id = ${owner} AND staged = 0
              AND EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = ${owner} AND staged = 1)`,
        sql`UPDATE auth_recovery_codes SET staged = 0 WHERE user_id = ${owner} AND staged = 1`,
        sql`UPDATE auth_factors SET confirmed_at = COALESCE(confirmed_at, ${at}), failed_attempts = 0, updated_at = ${at}
            WHERE id = ${key} AND user_id = ${owner}`,
      ]);
      return outcome.ok ? ok(undefined) : err(storeError("recoveryCodes.commit", outcome.error));
    },

    async consume(userId, factorId, hash, at) {
      const owner = uuidKey(userId);
      const key = uuidKey(factorId);
      if (!owner || !key) return ok(false);
      // The reset is conditioned on this call's own stamp, so a code already spent clears no guesses.
      const outcome = await db.batch([
        sql`UPDATE auth_recovery_codes SET used_at = ${at}
            WHERE user_id = ${owner} AND code_hash = ${hash} AND staged = 0 AND used_at IS NULL`,
        sql`UPDATE auth_factors SET failed_attempts = 0
            WHERE id = ${key} AND user_id = ${owner}
              AND EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = ${owner} AND code_hash = ${hash} AND used_at = ${at})`,
      ]);
      if (!outcome.ok) return err(storeError("recoveryCodes.consume", outcome.error));
      return ok(outcome.data[0]?.rowsWritten === 1);
    },

    async remaining(userId) {
      const owner = uuidKey(userId);
      if (!owner) return ok(0);
      const outcome = await db.queryOne<{ remaining: number }>(
        sql`SELECT COUNT(*) AS remaining FROM auth_recovery_codes WHERE user_id = ${owner} AND staged = 0 AND used_at IS NULL`,
      );
      return outcome.ok ? ok(outcome.data?.remaining ?? 0) : err(storeError("recoveryCodes.remaining", outcome.error));
    },
  };
}
