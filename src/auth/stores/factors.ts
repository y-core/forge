import { uuidFromBytes, uuidv7Bytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { FactorStore } from "../types";
import { inList, readFactor, readMaybe, readRow, storeError, unknownOwner, uuidKey } from "./rows";
import type { FactorRow } from "./types";

/** Creates the `FactorStore` over a SQL database. @public */
export function createFactorStore(db: D1Client): FactorStore {
  return {
    async listByUser(userId) {
      const key = uuidKey(userId);
      if (!key) return ok([]);
      const outcome = await db.query<FactorRow>(sql`SELECT * FROM auth_factors WHERE user_id = ${key} ORDER BY id`);
      return outcome.ok ? readRow("factors.listByUser", () => outcome.data.map(readFactor)) : err(storeError("factors.listByUser", outcome.error));
    },

    async find(userId, kind) {
      const key = uuidKey(userId);
      if (!key) return ok(null);
      const outcome = await db.queryOne<FactorRow>(sql`SELECT * FROM auth_factors WHERE user_id = ${key} AND kind = ${kind}`);
      return outcome.ok ? readMaybe("factors.find", outcome.data, readFactor) : err(storeError("factors.find", outcome.error));
    },

    async findEnrolled(userId, kinds) {
      // One statement whatever the offered-factor count is: the registry resolves every offered
      // factor against enrolments in this single query.
      const key = uuidKey(userId);
      if (kinds.length === 0 || !key) return ok([]);
      const outcome = await db.query<FactorRow>(sql`SELECT * FROM auth_factors WHERE user_id = ${key} AND kind IN (${inList(kinds)}) ORDER BY id`);
      return outcome.ok
        ? readRow("factors.findEnrolled", () => outcome.data.map(readFactor))
        : err(storeError("factors.findEnrolled", outcome.error));
    },

    async enrol(input, at) {
      const owner = uuidKey(input.userId);
      if (!owner) return err(unknownOwner("factors.enrol"));
      const idBytes = uuidv7Bytes();
      const secret = input.secret ?? null;
      const outcome = await db.execute(
        sql`INSERT INTO auth_factors (id, user_id, kind, secret, confirmed_at, created_at, updated_at)
            VALUES (${idBytes}, ${owner}, ${input.kind}, ${secret}, ${input.confirmedAt ?? null}, ${at}, ${at})`,
      );
      if (!outcome.ok) return err(storeError("factors.enrol", outcome.error));
      return ok({
        id: uuidFromBytes(idBytes),
        userId: input.userId,
        kind: input.kind,
        secret,
        lastCounter: null,
        failedAttempts: 0,
        confirmedAt: input.confirmedAt ?? null,
        createdAt: at,
        updatedAt: at,
      });
    },

    // The owner is in the statement and not in a prior read, so a factor id belonging to somebody
    // else changes no row rather than being caught by a check the caller has to remember.
    async confirm(id, userId, at) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const outcome = await db.execute(
        sql`UPDATE auth_factors SET confirmed_at = ${at}, updated_at = ${at} WHERE id = ${key} AND user_id = ${owner}`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("factors.confirm", outcome.error));
    },

    async countAttempt(userId, kind, maxAttempts, at, lockoutMs) {
      const owner = uuidKey(userId);
      if (!owner) return ok(null);
      // Keyed on the owner and the kind, not on a row id a caller had to `find` first: the guess is
      // spent by the same statement that locates the row and hands it back, so a read cannot sit
      // between the two. N parallel guesses then spend N of the budget rather than each comparing
      // against a count none of them has written yet. A refused guess writes nothing, so `updated_at`
      // is when the cap was hit and the window runs from there.
      const lockedUntil = at - lockoutMs;
      const outcome = await db.queryOne<FactorRow>(
        sql`UPDATE auth_factors
            SET failed_attempts = CASE WHEN failed_attempts >= ${maxAttempts} AND updated_at <= ${lockedUntil} THEN 1 ELSE failed_attempts + 1 END,
                updated_at = ${at}
            WHERE user_id = ${owner} AND kind = ${kind} AND (failed_attempts < ${maxAttempts} OR updated_at <= ${lockedUntil})
            RETURNING *`,
      );
      return outcome.ok ? readMaybe("factors.countAttempt", outcome.data, readFactor) : err(storeError("factors.countAttempt", outcome.error));
    },

    async advanceCounter(id, userId, counter, at) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const outcome = await db.execute(
        sql`UPDATE auth_factors SET last_counter = ${counter}, failed_attempts = 0, updated_at = ${at}
            WHERE id = ${key} AND user_id = ${owner} AND (last_counter IS NULL OR last_counter < ${counter})`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("factors.advanceCounter", outcome.error));
    },

    async remove(id, userId) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const outcome = await db.execute(sql`DELETE FROM auth_factors WHERE id = ${key} AND user_id = ${owner}`);
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("factors.remove", outcome.error));
    },
  };
}
