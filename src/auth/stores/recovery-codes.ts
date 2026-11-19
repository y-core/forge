import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import { uuidv7Bytes } from "../../storage/db/uuid";
import type { RecoveryCodeStore } from "../types";
import { authSecurityEventStatement } from "./events";
import { storeError, unknownOwner, uuidKey } from "./rows";
import { authSessionRevocation } from "./sessions";

// D1 binds at most 100 params per statement, and each staged row binds five.
const RECOVERY_CODE_INSERT_ROWS = 20;

/** Creates the `RecoveryCodeStore` over a SQL database — codes held only as their SHA-256, matched within their owner. @public */
export function createRecoveryCodeStore(db: D1Client): RecoveryCodeStore {
  return {
    async stage(userId, hashes, at) {
      const owner = uuidKey(userId);
      if (!owner) return err(unknownOwner("recoveryCodes.stage"));
      const chunks = Array.from({ length: Math.ceil(hashes.length / RECOVERY_CODE_INSERT_ROWS) }, (_, index) =>
        hashes.slice(index * RECOVERY_CODE_INSERT_ROWS, (index + 1) * RECOVERY_CODE_INSERT_ROWS),
      );
      const outcome = await db.batch([
        sql`DELETE FROM auth_recovery_codes WHERE user_id = ${owner} AND staged = 1`,
        ...chunks.map((chunk) => {
          const values = chunk
            .map((hash) => sql`(${uuidv7Bytes()}, ${owner}, ${hash}, 1, ${null}, ${at})`)
            .reduce((list, row) => sql`${list}, ${row}`);
          return sql`INSERT INTO auth_recovery_codes (id, user_id, code_hash, staged, used_at, created_at)
                VALUES ${values}`;
        }),
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

    async commit(userId, factorId, at, origin) {
      const owner = uuidKey(userId);
      const key = uuidKey(factorId);
      if (!owner || !key) return err(unknownOwner("recoveryCodes.commit"));
      const outcome = await db.batch([
        authSecurityEventStatement(
          { userKey: owner, type: "recovery-codes-issued", factorKind: "recovery-code", keep: origin.keep, adminKey: null, at },
          sql`EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = ${owner} AND staged = 1)`,
        ),
        authSessionRevocation(owner, origin.keep, sql`changes() > 0`),
        sql`DELETE FROM auth_recovery_codes WHERE user_id = ${owner} AND staged = 0
              AND EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = ${owner} AND staged = 1)`,
        sql`UPDATE auth_recovery_codes SET staged = 0 WHERE user_id = ${owner} AND staged = 1`,
        sql`UPDATE auth_factors SET confirmed_at = COALESCE(confirmed_at, ${at}), failed_attempts = 0, updated_at = ${at}
            WHERE id = ${key} AND user_id = ${owner}`,
      ]);
      return outcome.ok ? ok((outcome.data[0]?.rowsWritten ?? 0) > 0) : err(storeError("recoveryCodes.commit", outcome.error));
    },

    async consume(userId, factorId, hash, at, origin) {
      const owner = uuidKey(userId);
      const key = uuidKey(factorId);
      if (!owner || !key) return ok(false);
      // The reset is conditioned on this call's own stamp, so a code already spent clears no guesses.
      const outcome = await db.batch([
        sql`UPDATE auth_recovery_codes SET used_at = ${at}
            WHERE user_id = ${owner} AND code_hash = ${hash} AND staged = 0 AND used_at IS NULL`,
        authSecurityEventStatement(
          { userKey: owner, type: "recovery-code-used", factorKind: "recovery-code", keep: origin.keep, adminKey: null, at },
          sql`changes() > 0`,
        ),
        authSessionRevocation(owner, origin.keep, sql`changes() > 0`),
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
