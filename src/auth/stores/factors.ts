import { base64urlDecode, uuidFromBytes, uuidv7Bytes } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { AuthFactorRequirement } from "../factors/types";
import { AUTH_KID_BYTES, assertAuthKeyId } from "../keys/token";
import { authLimit } from "../limits";
import type { AuthStoreResult, FactorStore } from "../types";
import { inList, readFactor, readMaybe, readRow, storeError, unknownOwner, uuidKey } from "./rows";
import type { FactorRow, TotpSecretPurgeOptions } from "./types";

const MIN_IDLE_MS = 86_400_000;
const MAX_IDLE_MS = 31_536_000_000;

/** Why a purge is refused where the deployment does not demand the factor it would drop. */
function unpromptedRefusal(requirement: Exclude<AuthFactorRequirement, "mandatory">): string {
  const offered = requirement === "optional" ? '"optional"' : `mandatory only for ${requirement.mandatoryForRoles.join(", ")}`;
  return (
    `purgeStaleTotpSecrets: this deployment offers "totp-app" as ${offered}, and dropping a row only routes a user to re-enrol where the factor is demanded of them — ` +
    "under any other requirement they lose their second factor with nothing asking them to replace it. Offer it as `mandatory`, or leave the retiring key on the ring."
  );
}

// A scheduled drop and not a refusal to open: refusing is the hard lockout `beginEnrolment`'s
// recovery exists to undo, while a dropped row resolves `enrolment-required` on a page that works.
/** Drops `totp-app` rows sealed under a key other than `activeKeyId` and unverified for `idleForMs`, answering how many went. Call it from a scheduled handler. @public */
export async function purgeStaleTotpSecrets(db: D1Client, at: number, options: TotpSecretPurgeOptions): Promise<AuthStoreResult<number>> {
  if (options.requirement !== "mandatory") throw new Error(unpromptedRefusal(options.requirement));
  // The statement deletes the complement of this id, so a malformed one matches no row's prefix and
  // would delete every idle enrolment. Refused before any statement runs, never narrowed after.
  const activeKeyId = options.keys.activeKeyId;
  assertAuthKeyId("purgeStaleTotpSecrets", activeKeyId);
  const idleForMs = authLimit("purgeStaleTotpSecrets", "idleForMs", options.idleForMs, {
    fallback: MIN_IDLE_MS,
    min: MIN_IDLE_MS,
    max: MAX_IDLE_MS,
    unit: "millisecond",
    floor: "a shorter window drops the factor of anyone away for a long weekend",
    ceiling: "past a year the rotation this bounds has waited longer than the cadence it serves",
  });
  const outcome = await db.execute(
    sql`DELETE FROM auth_factors
        WHERE kind = 'totp-app' AND secret IS NOT NULL
          AND substr(secret, 1, ${AUTH_KID_BYTES}) != ${base64urlDecode(activeKeyId)}
          AND COALESCE(last_verified_at, created_at) <= ${at - idleForMs}`,
  );
  return outcome.ok ? ok(outcome.data.rowsWritten) : err(storeError("factors.purgeStaleTotpSecrets", outcome.error));
}

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
        lastVerifiedAt: null,
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

    // `failed_attempts` is cleared by the same statement: the budget guarded a secret that can no
    // longer be checked, so carrying the spend forward would only lock the re-enrolment behind it.
    async unconfirm(id, userId, at) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const outcome = await db.execute(
        sql`UPDATE auth_factors SET confirmed_at = NULL, failed_attempts = 0, updated_at = ${at} WHERE id = ${key} AND user_id = ${owner}`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("factors.unconfirm", outcome.error));
    },

    async countAttempt(userId, kind, maxAttempts, at, lockoutMs) {
      const owner = uuidKey(userId);
      if (!owner) return ok(null);
      // The guess is spent by the same statement that locates the row, so no read sits between the
      // two and N parallel guesses spend N of the budget rather than one apiece.
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

    // The re-sealed secret rides this statement rather than a second one, so it lands under the same
    // replay guard: a code presented twice writes no row, and therefore re-seals nothing either.
    async recordVerification(id, userId, counter, at, secret) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const reseal = secret === undefined ? sql`` : sql`, secret = ${secret}`;
      const outcome = await db.execute(
        sql`UPDATE auth_factors SET last_counter = ${counter}, failed_attempts = 0, last_verified_at = ${at}, updated_at = ${at}${reseal}
            WHERE id = ${key} AND user_id = ${owner} AND (last_counter IS NULL OR last_counter < ${counter})`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("factors.recordVerification", outcome.error));
    },

    // `substr` over the blob, not a column of its own: the key id is the frame's first six bytes,
    // so a schema that stored it twice could disagree with the bytes that actually decide the open.
    async countSecretsNotUnder(kind, kid) {
      const outcome = await db.queryOne<{ held: number }>(
        sql`SELECT COUNT(*) AS held FROM auth_factors
            WHERE kind = ${kind} AND secret IS NOT NULL AND substr(secret, 1, ${AUTH_KID_BYTES}) != ${base64urlDecode(kid)}`,
      );
      return outcome.ok ? ok(outcome.data?.held ?? 0) : err(storeError("factors.countSecretsNotUnder", outcome.error));
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
