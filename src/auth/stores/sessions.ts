import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client, SqlFragment } from "../../storage/db/types";
import { uuidv7Bytes } from "../../storage/db/uuid";
import { AUTH_SESSION_IDLE_MS, AUTH_SESSION_MAX_MS } from "../config";
import { authLimit } from "../limits";
import type { AuthSessionRotation, AuthSessionStepUp, AuthSessionStore, AuthStoreResult, AuthWriteOrigin } from "../types";
import { authSecurityEventStatement } from "./events";
import { DEFAULT_PAGE_LIMIT, readAuthSession, readAuthSessionRecord, readMaybe, readRow, storeError, unknownOwner, uuidKey } from "./rows";
import type { AuthSessionBounds, AuthSessionRecordRow, AuthSessionRow, AuthSessionStoreOptions } from "./types";

const OPERATION = "createAuthSessionStore";

const MIN_SESSION_MS = 300_000;

const MIN_SESSION_TOUCH_INTERVAL_MS = 60_000;

const SESSION_TOUCHES_PER_IDLE_BOUND = 12;

/** Resolves `options` against the defaults, throwing on a lifetime outside its range. @internal */
export function authSessionBounds(options: AuthSessionStoreOptions = {}): AuthSessionBounds {
  const absoluteLifetimeMs = authLimit(OPERATION, "absoluteLifetimeMs", options.absoluteLifetimeMs, {
    fallback: AUTH_SESSION_MAX_MS,
    min: MIN_SESSION_MS,
    max: AUTH_SESSION_MAX_MS,
    unit: "millisecond",
    floor: "a session that ends inside five minutes signs a reader out mid-page",
    ceiling: "a session outliving a week gives a stolen token more than a week to be used",
  });
  const idleTimeoutMs =
    options.idleTimeoutMs === null
      ? null
      : authLimit(OPERATION, "idleTimeoutMs", options.idleTimeoutMs, {
          fallback: Math.min(AUTH_SESSION_IDLE_MS, absoluteLifetimeMs),
          min: MIN_SESSION_MS,
          max: absoluteLifetimeMs,
          unit: "millisecond",
          floor: "an idle bound shorter than reading one page signs a reader out mid-page",
          ceiling: "past the absolute lifetime an idle bound bounds nothing, so pass `null`",
        });
  const touchIntervalMs = Math.max(
    MIN_SESSION_TOUCH_INTERVAL_MS,
    Math.floor((idleTimeoutMs ?? AUTH_SESSION_IDLE_MS) / SESSION_TOUCHES_PER_IDLE_BOUND),
  );
  return { absoluteLifetimeMs, idleTimeoutMs, touchIntervalMs };
}

/** The statement moving the session `rotation.replaces` names onto `rotation.tokenHash` in place, recording `stepUp` where given, run only where `guard` holds. @internal */
export function authSessionRotation(rotation: AuthSessionRotation, stepUp?: AuthSessionStepUp, guard: SqlFragment = sql``): SqlFragment[] {
  const stamp = stepUp === undefined ? sql`` : sql`, step_up_at = ${stepUp.at}, step_up_kind = ${stepUp.kind}`;
  return [sql`UPDATE auth_sessions SET token_hash = ${rotation.tokenHash}${stamp} WHERE token_hash = ${rotation.replaces}${guard}`];
}

/** The statement deleting every session `ownerKey` holds except the one `keep` names, run only where `guard` holds. @internal */
export function authSessionRevocation(ownerKey: Uint8Array<ArrayBuffer>, keep: Uint8Array<ArrayBuffer> | null, guard?: SqlFragment): SqlFragment {
  // `token_hash != NULL` matches no row, so with no session to spare the term is dropped, never bound.
  const spared = keep === null ? sql`` : sql` AND token_hash != ${keep}`;
  const guarded = guard === undefined ? sql`` : sql` AND ${guard}`;
  return sql`DELETE FROM auth_sessions WHERE user_id = ${ownerKey}${spared}${guarded}`;
}

/** Runs `revocation`, recording `sessions-revoked` in its batch only where it deleted a row, and answers how many went. */
async function revokeSessions(
  db: D1Client,
  operation: string,
  ownerKey: Uint8Array<ArrayBuffer>,
  revocation: SqlFragment,
  at: number,
  origin: AuthWriteOrigin,
): Promise<AuthStoreResult<number>> {
  const outcome = await db.batch([
    revocation,
    authSecurityEventStatement(
      { userKey: ownerKey, type: "sessions-revoked", factorKind: null, keep: origin.keep, adminKey: null, at },
      sql`changes() > 0`,
    ),
  ]);
  return outcome.ok ? ok(outcome.data[0]?.rowsWritten ?? 0) : err(storeError(operation, outcome.error));
}

/** Creates the `AuthSessionStore` over a SQL database — rows keyed by token hash, revoked by deletion, and dead past `options`' absolute or idle lifetime. @public */
export function createAuthSessionStore(db: D1Client, options?: AuthSessionStoreOptions): AuthSessionStore {
  const { absoluteLifetimeMs, idleTimeoutMs, touchIntervalMs } = authSessionBounds(options);
  return {
    async create(input, replaces) {
      const owner = uuidKey(input.userId);
      if (!owner) return err(unknownOwner("sessions.create"));
      const outcome = await db.batch([
        ...(replaces ? [sql`DELETE FROM auth_sessions WHERE token_hash = ${replaces}`] : []),
        sql`INSERT INTO auth_sessions (token_hash, user_id, signed_in_at, expires_at, step_up_at, id, step_up_kind, last_seen_at, device)
            VALUES (${input.tokenHash}, ${owner}, ${input.signedInAt}, ${input.signedInAt + absoluteLifetimeMs}, ${input.stepUp?.at ?? null}, ${uuidv7Bytes()}, ${input.stepUp?.kind ?? null}, ${input.signedInAt}, ${input.device ?? null})`,
        authSecurityEventStatement({
          userKey: owner,
          type: "signed-in",
          factorKind: input.signedInWith,
          keep: input.tokenHash,
          adminKey: null,
          at: input.signedInAt,
        }),
      ]);
      return outcome.ok ? ok() : err(storeError("sessions.create", outcome.error));
    },

    async resolve(tokenHash, at) {
      const idle = idleTimeoutMs === null ? sql`` : sql` AND auth_sessions.last_seen_at > ${at - idleTimeoutMs}`;
      const outcome = await db.queryOne<AuthSessionRow>(
        sql`SELECT auth_users.id, auth_users.email, auth_users.is_admin, auth_sessions.id AS session_id, auth_sessions.signed_in_at, auth_sessions.expires_at, auth_sessions.step_up_at, auth_sessions.step_up_kind, auth_sessions.last_seen_at, auth_sessions.device
            FROM auth_sessions JOIN auth_users ON auth_users.id = auth_sessions.user_id
            WHERE auth_sessions.token_hash = ${tokenHash} AND auth_sessions.expires_at > ${at} AND auth_users.deactivated_at IS NULL${idle}`,
      );
      if (!outcome.ok) return err(storeError("sessions.resolve", outcome.error));
      const found = readMaybe("sessions.resolve", outcome.data, readAuthSession);
      if (found.ok && found.data !== null && at - found.data.session.lastSeenAt >= touchIntervalMs) {
        await db.execute(
          sql`UPDATE auth_sessions SET last_seen_at = ${at} WHERE token_hash = ${tokenHash} AND last_seen_at <= ${at - touchIntervalMs}`,
        );
      }
      return found;
    },

    async rotate(replaces, tokenHash, stepUp) {
      const stepped =
        stepUp === undefined
          ? []
          : [
              authSecurityEventStatement(
                {
                  userKey: sql`(SELECT user_id FROM auth_sessions WHERE token_hash = ${tokenHash})`,
                  type: "stepped-up",
                  factorKind: stepUp.kind,
                  keep: tokenHash,
                  adminKey: null,
                  at: stepUp.at,
                },
                sql`changes() > 0`,
              ),
            ];
      const outcome = await db.batch([...authSessionRotation({ replaces, tokenHash }, stepUp), ...stepped]);
      return outcome.ok ? ok((outcome.data[0]?.rowsWritten ?? 0) > 0) : err(storeError("sessions.rotate", outcome.error));
    },

    async remove(tokenHash) {
      const outcome = await db.execute(sql`DELETE FROM auth_sessions WHERE token_hash = ${tokenHash}`);
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("sessions.remove", outcome.error));
    },

    async listByUser(userId, at) {
      const key = uuidKey(userId);
      if (!key) return ok([]);
      const idle = idleTimeoutMs === null ? sql`` : sql` AND last_seen_at > ${at - idleTimeoutMs}`;
      const outcome = await db.query<AuthSessionRecordRow>(
        sql`SELECT id AS session_id, signed_in_at, expires_at, step_up_at, step_up_kind, last_seen_at, device
            FROM auth_sessions WHERE user_id = ${key} AND expires_at > ${at}${idle}
            ORDER BY signed_in_at DESC, id DESC LIMIT ${DEFAULT_PAGE_LIMIT}`,
      );
      return outcome.ok
        ? readRow("sessions.listByUser", () => outcome.data.map(readAuthSessionRecord))
        : err(storeError("sessions.listByUser", outcome.error));
    },

    async revoke(userId, sessionId, at, origin) {
      const owner = uuidKey(userId);
      const key = uuidKey(sessionId);
      if (!owner || !key) return ok(false);
      const revoked = await revokeSessions(db, "sessions.revoke", owner, authSessionRevocation(owner, origin.keep, sql`id = ${key}`), at, origin);
      return revoked.ok ? ok(revoked.data > 0) : revoked;
    },

    async revokeOthers(userId, at, origin) {
      const owner = uuidKey(userId);
      if (!owner) return ok(0);
      return revokeSessions(db, "sessions.revokeOthers", owner, authSessionRevocation(owner, origin.keep), at, origin);
    },
  };
}
