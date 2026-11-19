import { KEY_RING_KID_BYTES } from "../../crypto/keyring/ring";
import { base64urlDecode } from "../../crypto/primitives/mod";
import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client, SqlFragment } from "../../storage/db/types";
import { uuidFromBytes, uuidv7Bytes } from "../../storage/db/uuid";
import { AUTH_SECOND_FACTORS } from "../config";
import type { AuthSecondFactorKind } from "../factors/types";
import { assertAuthKeyId } from "../keys/token";
import { authLimit } from "../limits";
import type { AuthFactorKind, AuthFactorRemoval, AuthStoreResult, FactorStore } from "../types";
import { authSecurityEventStatement } from "./events";
import { readFactor, readMaybe, readRow, storeError, unknownOwner, uuidKey } from "./rows";
import { authSessionRevocation } from "./sessions";
import type { AuthSecondFactorFloor, FactorRow, TotpSecretPurgeOptions, TotpSecretPurgeReport } from "./types";

const MIN_IDLE_MS = 86_400_000;
const RECOVERABLE_IN = sql`SELECT value FROM json_each(${JSON.stringify(AUTH_SECOND_FACTORS)})`;
const MAX_IDLE_MS = 31_536_000_000;

/** The statements dropping `ownerKey`'s recovery codes and their factor row once no confirmed recoverable factor remains. @internal */
export function authRecoveryCascade(ownerKey: Uint8Array<ArrayBuffer>): SqlFragment[] {
  const holdsAnother = sql`EXISTS (SELECT 1 FROM auth_factors
    WHERE user_id = ${ownerKey} AND kind IN (${RECOVERABLE_IN}) AND confirmed_at IS NOT NULL)`;
  return [
    sql`DELETE FROM auth_recovery_codes WHERE user_id = ${ownerKey} AND NOT ${holdsAnother}`,
    sql`DELETE FROM auth_factors WHERE user_id = ${ownerKey} AND kind = ${"recovery-code"} AND NOT ${holdsAnother}`,
  ];
}

// A user holds at most one row of a kind, and a passkey's row goes only with its last credential, so
// "drops no confirmed row of a floor kind" is exactly "leaves every mandatory kind held".
/** A condition true unless the `auth_factors` rows `dropped` matches take a confirmed row of a `floor` kind from `ownerKey`. @internal */
export function authSecondFactorRemains(
  ownerKey: Uint8Array<ArrayBuffer> | SqlFragment,
  floor: AuthSecondFactorFloor,
  dropped: SqlFragment,
): SqlFragment {
  if (floor.length === 0) return sql`1`;
  return sql`NOT EXISTS (SELECT 1 FROM auth_factors WHERE user_id = ${ownerKey} AND confirmed_at IS NOT NULL
    AND kind IN (SELECT value FROM json_each(${JSON.stringify(floor)})) AND (${dropped}))`;
}

/** Names what a guarded removal batch did from its probe row and the rows its delete wrote. @internal */
export function authFactorRemovalOutcome(
  operation: string,
  probe: { readonly present: number; readonly removable: number } | undefined,
  removed: number,
): AuthStoreResult<AuthFactorRemoval> {
  if (probe === undefined || probe.present === 0) return ok("not-found");
  if (probe.removable === 0) return ok("second-factor-required");
  // The probe only names the refusal; the DELETE is what decides. Disagreeing with it inside one
  // transaction is a backend the caller cannot reason about, so it is reported as such.
  return removed > 0 ? ok("changed") : err(storeError(operation, "the guarded delete matched the probe but removed no row"));
}

function refuseOfferedKinds(kinds: readonly AuthSecondFactorKind[]): void {
  const seen = new Set<AuthSecondFactorKind>();
  for (const kind of kinds) {
    if (!AUTH_SECOND_FACTORS.includes(kind)) {
      const named = AUTH_SECOND_FACTORS.map((offered) => `"${offered}"`).join(", ");
      throw new Error(`purgeStaleTotpSecrets: "${kind}" is not a second factor — only ${named} may be offered as one`);
    }
    if (seen.has(kind)) throw new Error(`purgeStaleTotpSecrets: "${kind}" is offered twice`);
    seen.add(kind);
  }
}

/** Why a purge is refused where the deployment does not make the second factor it would drop mandatory, or `null` where it does. */
function unpromptedRefusal(factors: TotpSecretPurgeOptions["factors"]): string | null {
  if (!factors.offered.includes("totp-app")) {
    return 'purgeStaleTotpSecrets: this deployment does not offer "totp-app" as a second factor, so it has no authenticator-app secret to purge.';
  }
  if (factors.mandatory.includes("totp-app")) return null;
  return (
    'purgeStaleTotpSecrets: this deployment offers "totp-app" as optional, and dropping a row only routes its owner to re-enrol where the factor is mandatory — ' +
    'otherwise they lose it with nothing asking them to replace it. Make "totp-app" mandatory, or leave the retiring key on the ring.'
  );
}

// A dropped row resolves `enrolment-required`, so the drop is safe only for a user who can step up with
// another second factor or a recovery code; anyone else would re-enrol on their mailbox alone.
/** Drops `totp-app` rows sealed under a key other than `activeKeyId` and unverified for `idleForMs`, keeping each one its owner could not step up without. @public */
export async function purgeStaleTotpSecrets(
  db: D1Client,
  at: number,
  options: TotpSecretPurgeOptions,
): Promise<AuthStoreResult<TotpSecretPurgeReport>> {
  refuseOfferedKinds(options.factors.offered);
  const refusal = unpromptedRefusal(options.factors);
  if (refusal !== null) throw new Error(refusal);
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
  const staleRow = sql`stale.kind = ${"totp-app"} AND stale.secret IS NOT NULL
    AND substr(stale.secret, 1, ${KEY_RING_KID_BYTES}) != ${base64urlDecode(activeKeyId)}
    AND COALESCE(stale.last_verified_at, stale.created_at) <= ${at - idleForMs}`;
  const others = JSON.stringify(options.factors.offered.filter((kind) => kind !== "totp-app"));
  const stepsUpWithout = sql`(stale.confirmed_at IS NULL
    OR EXISTS (SELECT 1 FROM auth_factors WHERE user_id = stale.user_id AND confirmed_at IS NOT NULL
      AND kind IN (SELECT value FROM json_each(${others})))
    OR EXISTS (SELECT 1 FROM auth_recovery_codes WHERE user_id = stale.user_id AND staged = 0 AND used_at IS NULL))`;
  const outcome = await db.batch<{ kept: number }>([
    sql`SELECT COUNT(*) AS kept FROM auth_factors AS stale WHERE ${staleRow} AND NOT ${stepsUpWithout}`,
    sql`DELETE FROM auth_factors WHERE id IN (SELECT stale.id FROM auth_factors AS stale WHERE ${staleRow} AND ${stepsUpWithout})`,
  ]);
  if (!outcome.ok) return err(storeError("factors.purgeStaleTotpSecrets", outcome.error));
  return ok({ purged: outcome.data[1]?.rowsWritten ?? 0, kept: outcome.data[0]?.results[0]?.kept ?? 0 });
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

    async listConfirmedKinds(userId, kinds) {
      // One statement whatever the offered-factor count is: the registry resolves every offered
      // factor against enrolments in this single query.
      const key = uuidKey(userId);
      if (kinds.length === 0 || !key) return ok([]);
      const kindsIn = sql`SELECT value FROM json_each(${JSON.stringify([...new Set(kinds)])})`;
      const outcome = await db.query<Pick<FactorRow, "kind">>(
        sql`SELECT kind FROM auth_factors WHERE user_id = ${key} AND kind IN (${kindsIn}) AND confirmed_at IS NOT NULL`,
      );
      return outcome.ok ? ok(outcome.data.map((row) => row.kind as AuthFactorKind)) : err(storeError("factors.listConfirmedKinds", outcome.error));
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
    async confirm(id, userId, at, origin) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const kind = sql`(SELECT kind FROM auth_factors WHERE id = ${key} AND user_id = ${owner})`;
      // A passkey's enrolment is the credential it registers, which records the event; confirming its row is bookkeeping.
      const outcome = await db.batch([
        sql`UPDATE auth_factors SET confirmed_at = ${at}, updated_at = ${at} WHERE id = ${key} AND user_id = ${owner} AND confirmed_at IS NULL`,
        authSecurityEventStatement(
          { userKey: owner, type: "factor-added", factorKind: kind, keep: origin.keep, adminKey: null, at },
          sql`changes() > 0 AND ${kind} != ${"passkey"}`,
        ),
        authSessionRevocation(owner, origin.keep, sql`changes() > 0`),
      ]);
      return outcome.ok ? ok((outcome.data[0]?.rowsWritten ?? 0) > 0) : err(storeError("factors.confirm", outcome.error));
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

    // The re-seal rides the replay guard, so a code presented twice re-seals nothing. The frame guard
    // makes a code checked against a since-replaced secret match no row, rather than write it back.
    async recordVerification(id, userId, counter, at, frame, resealed) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const reseal = resealed === undefined ? sql`` : sql`, secret = ${resealed}`;
      const outcome = await db.execute(
        sql`UPDATE auth_factors SET last_counter = ${counter}, failed_attempts = 0, last_verified_at = ${at}, updated_at = ${at}${reseal}
            WHERE id = ${key} AND user_id = ${owner} AND secret = ${frame} AND (last_counter IS NULL OR last_counter < ${counter})`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("factors.recordVerification", outcome.error));
    },

    // Updated in place rather than deleted and re-enrolled, so no instant leaves the user without a
    // second factor and the removal floor is never consulted.
    async replaceSecret(id, userId, secret, counter, at, origin) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok(false);
      const outcome = await db.batch([
        sql`UPDATE auth_factors SET secret = ${secret}, last_counter = ${counter}, failed_attempts = 0, last_verified_at = ${at}, updated_at = ${at}
            WHERE id = ${key} AND user_id = ${owner} AND kind = ${"totp-app"} AND confirmed_at IS NOT NULL`,
        authSecurityEventStatement(
          { userKey: owner, type: "factor-replaced", factorKind: "totp-app", keep: origin.keep, adminKey: null, at },
          sql`changes() > 0`,
        ),
        authSessionRevocation(owner, origin.keep, sql`changes() > 0`),
      ]);
      return outcome.ok ? ok((outcome.data[0]?.rowsWritten ?? 0) > 0) : err(storeError("factors.replaceSecret", outcome.error));
    },

    // `substr` over the blob, not a column of its own: the key id is the frame's first six bytes,
    // so a schema that stored it twice could disagree with the bytes that actually decide the open.
    async countSecretsNotUnder(kind, kid) {
      const outcome = await db.queryOne<{ held: number }>(
        sql`SELECT COUNT(*) AS held FROM auth_factors
            WHERE kind = ${kind} AND secret IS NOT NULL AND substr(secret, 1, ${KEY_RING_KID_BYTES}) != ${base64urlDecode(kid)}`,
      );
      return outcome.ok ? ok(outcome.data?.held ?? 0) : err(storeError("factors.countSecretsNotUnder", outcome.error));
    },

    async remove(id, userId, at, origin, floor) {
      const key = uuidKey(id);
      const owner = uuidKey(userId);
      if (!key || !owner) return ok("not-found");
      const target = sql`id = ${key} AND user_id = ${owner}`;
      const removable = authSecondFactorRemains(owner, floor, sql`id = ${key}`);
      const outcome = await db.batch<{ present: number; removable: number }>([
        sql`SELECT (SELECT COUNT(*) FROM auth_factors WHERE ${target}) AS present, ${removable} AS removable`,
        authSecurityEventStatement(
          {
            userKey: owner,
            type: "factor-removed",
            factorKind: sql`(SELECT kind FROM auth_factors WHERE ${target})`,
            keep: origin.keep,
            adminKey: null,
            at,
          },
          sql`EXISTS (SELECT 1 FROM auth_factors WHERE ${target} AND confirmed_at IS NOT NULL) AND ${removable}`,
        ),
        authSessionRevocation(owner, origin.keep, sql`changes() > 0`),
        sql`DELETE FROM auth_factors WHERE ${target} AND ${removable}`,
        ...authRecoveryCascade(owner),
      ]);
      if (!outcome.ok) return err(storeError("factors.remove", outcome.error));
      return authFactorRemovalOutcome("factors.remove", outcome.data[0]?.results[0], outcome.data[3]?.rowsWritten ?? 0);
    },
  };
}
