import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { AuthStoreResult } from "../types";
import { storeError } from "./rows";

/** The separator between an ephemeral store's prefix and the caller's key. @internal */
export const EPHEMERAL_SEPARATOR = "||";

/** Joins a store's prefix to a caller's key, so two stores over one table cannot collide. @internal */
export function ephemeralKey(prefix: string, key: string): string {
  return `${prefix}${EPHEMERAL_SEPARATOR}${key}`;
}

/** The instant a lifetime of `ttlSeconds` runs out at. @internal */
export function ephemeralExpiry(ttlSeconds: number): number {
  return Date.now() + Math.ceil(ttlSeconds) * 1000;
}

// KV expired a key on its own; SQLite keeps it. Every read holds a row against the clock, so a dead
// row is already inert — this only reclaims the space, and a deployment that never calls it is
// slower rather than wrong.
/** Deletes the challenge and nonce rows that expired at or before `at`. Call it from a scheduled handler. @public */
export async function purgeAuthEphemera(db: D1Client, at: number): Promise<AuthStoreResult<void>> {
  const outcome = await db.batch([
    sql`DELETE FROM auth_challenges WHERE expires_at <= ${at}`,
    sql`DELETE FROM auth_nonces WHERE expires_at <= ${at}`,
  ]);
  return outcome.ok ? ok() : err(storeError("ephemera.purge", outcome.error));
}
