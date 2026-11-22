import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client, SqlFragment } from "../../storage/db/types";
import { AUTH_SECURITY_EVENT_TTL_MS, AUTH_UNVERIFIED_USER_TTL_MS } from "../config";
import { authLimit } from "../limits";
import type { AuthStoreResult } from "../types";
import { isAppKeyDeleteRefusal, storeError } from "./rows";
import type { AuthEphemeraPurgeOptions, AuthEphemeraPurgeReport } from "./types";

const MIN_UNVERIFIED_USER_TTL_MS = 3_600_000;

const MIN_SECURITY_EVENT_TTL_MS = 2_592_000_000;

const PURGE_STEP_ROWS = 1000;

const PURGE_USER_STEP_ROWS = 100;

const PURGE_STEPS_PER_TABLE = 8;

type PurgedTable = keyof AuthEphemeraPurgeReport["deleted"];

interface PurgeStep {
  readonly table: PurgedTable;
  readonly rows: number;
  readonly statement: (limit: number) => SqlFragment;
}

interface PurgedRows {
  readonly deleted: number;
  readonly complete: boolean;
  readonly blocked: boolean;
}

/** The separator between an ephemeral store's prefix and the caller's key. @internal */
export const EPHEMERAL_SEPARATOR = "||";

/** Joins a store's prefix to a caller's key; `assertEphemeralPrefix` keeps the separator out of the prefix, so the first one in a key ends it and two stores over one table cannot collide. @internal */
export function ephemeralKey(prefix: string, key: string): string {
  return `${prefix}${EPHEMERAL_SEPARATOR}${key}`;
}

/** Why `prefix` cannot head an ephemeral key, or `undefined` when it can. @internal */
export function ephemeralPrefixFault(prefix: string): "empty" | "separator" | undefined {
  if (prefix === "") return "empty";
  // A trailing `|` joins the separator's first, so `a|` then `||x` reads as `a` then `|x`.
  return prefix.includes(EPHEMERAL_SEPARATOR) || prefix.endsWith("|") ? "separator" : undefined;
}

/** Throws, naming `operation`, unless `prefix` can head an ephemeral key. @internal */
export function assertEphemeralPrefix(operation: string, prefix: string): void {
  const fault = ephemeralPrefixFault(prefix);
  if (fault === "empty") {
    throw new Error(
      `${operation}: \`prefix\` must not be an empty string — an empty prefix drops the separator too, so the store shares a keyspace with every other store on the binding.`,
    );
  }
  if (fault === "separator") {
    throw new Error(
      `${operation}: \`prefix\` must not hold \`${EPHEMERAL_SEPARATOR}\` or end in \`|\` — a key would then split in two places, so another prefix's key can match it.`,
    );
  }
}

/** The instant a lifetime of `ttlSeconds` runs out at. @internal */
export function ephemeralExpiry(ttlSeconds: number): number {
  return Date.now() + Math.ceil(ttlSeconds) * 1000;
}

// A dead ephemeral row is already inert, since every read holds it against the clock; an unverified
// account is not, because sign-up writes one for any address asked about and nothing else removes it.
/** Deletes, in bounded steps, the challenge, nonce and session rows that expired at or before `at`, every security event older than `securityEventTtlMs`, and every account still unverified `unverifiedUserTtlMs` after it was created, reporting what it deleted, which tables a constraint blocked, and whether any lapsed row remains. Call it from a scheduled handler. @public */
export async function purgeAuthEphemera(
  db: D1Client,
  at: number,
  options: AuthEphemeraPurgeOptions = {},
): Promise<AuthStoreResult<AuthEphemeraPurgeReport>> {
  const unverifiedUserTtlMs = authLimit("purgeAuthEphemera", "unverifiedUserTtlMs", options.unverifiedUserTtlMs, {
    fallback: AUTH_UNVERIFIED_USER_TTL_MS,
    min: MIN_UNVERIFIED_USER_TTL_MS,
    unit: "millisecond",
    floor: "an account deleted inside an hour can lose the sign-up whose code is still on its way",
  });
  const securityEventTtlMs = authLimit("purgeAuthEphemera", "securityEventTtlMs", options.securityEventTtlMs, {
    fallback: AUTH_SECURITY_EVENT_TTL_MS,
    min: MIN_SECURITY_EVENT_TTL_MS,
    unit: "millisecond",
    floor: "a record kept under thirty days is gone before most account holders notice a change they did not make",
  });
  const userCutoff = at - unverifiedUserTtlMs;
  const eventCutoff = at - securityEventTtlMs;
  // Never `ORDER BY rowid`, which walks rowid order instead of the index; counted by `RETURNING`, not the change count a cascade inflates.
  // Accounts go last, so the sessions and events their deletion cascades into are already thinned.
  const steps: readonly PurgeStep[] = [
    {
      table: "challenges",
      rows: PURGE_STEP_ROWS,
      statement: (limit) =>
        sql`DELETE FROM auth_challenges WHERE rowid IN (SELECT rowid FROM auth_challenges WHERE expires_at <= ${at} ORDER BY expires_at LIMIT ${limit}) RETURNING rowid`,
    },
    {
      table: "nonces",
      rows: PURGE_STEP_ROWS,
      statement: (limit) =>
        sql`DELETE FROM auth_nonces WHERE rowid IN (SELECT rowid FROM auth_nonces WHERE expires_at <= ${at} ORDER BY expires_at LIMIT ${limit}) RETURNING rowid`,
    },
    {
      table: "signIns",
      rows: PURGE_STEP_ROWS,
      statement: (limit) =>
        sql`DELETE FROM auth_sessions WHERE rowid IN (SELECT rowid FROM auth_sessions WHERE expires_at <= ${at} ORDER BY expires_at LIMIT ${limit}) RETURNING rowid`,
    },
    {
      table: "securityEvents",
      rows: PURGE_STEP_ROWS,
      statement: (limit) =>
        sql`DELETE FROM auth_security_events WHERE rowid IN (SELECT rowid FROM auth_security_events WHERE at <= ${eventCutoff} ORDER BY at LIMIT ${limit}) RETURNING rowid`,
    },
    {
      table: "users",
      rows: PURGE_USER_STEP_ROWS,
      statement: (limit) =>
        sql`DELETE FROM auth_users WHERE rowid IN (SELECT rowid FROM auth_users WHERE email_verified_at IS NULL AND created_at <= ${userCutoff} ORDER BY created_at LIMIT ${limit}) RETURNING rowid`,
    },
  ];
  const deleted = { challenges: 0, nonces: 0, signIns: 0, users: 0, securityEvents: 0 };
  const blocked: PurgedTable[] = [];
  let complete = true;
  for (const step of steps) {
    const purged = await purgeTable(db, step);
    if (!purged.ok) return purged;
    deleted[step.table] = purged.data.deleted;
    complete &&= purged.data.complete;
    if (purged.data.blocked) blocked.push(step.table);
  }
  return ok({ deleted, complete, blocked });
}

/** Runs one table's bounded deletes until a step comes back short, the step ceiling runs out, or a foreign-key, NOT NULL or CHECK constraint refuses one. */
async function purgeTable(db: D1Client, step: PurgeStep): Promise<AuthStoreResult<PurgedRows>> {
  let deleted = 0;
  for (let taken = 0; taken < PURGE_STEPS_PER_TABLE; taken += 1) {
    // oxlint-disable-next-line forge/sql-in-loop -- one bounded step of a bulk delete per pass, capped at PURGE_STEPS_PER_TABLE, not a statement per item
    const outcome = await db.query(step.statement(step.rows));
    if (!outcome.ok) {
      if (isAppKeyDeleteRefusal(outcome.error)) return ok({ deleted, complete: false, blocked: true });
      return err(storeError(`ephemera.purge.${step.table}`, outcome.error));
    }
    deleted += outcome.data.length;
    if (outcome.data.length < step.rows) return ok({ deleted, complete: true, blocked: false });
  }
  return ok({ deleted, complete: false, blocked: false });
}
