import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { NonceStore } from "../types";
import { ephemeralExpiry, ephemeralKey } from "./ephemera";
import { storeError } from "./rows";
import type { NonceStoreOptions } from "./types";

const DEFAULT_PREFIX = "auth:nonce";

/** Creates the `NonceStore` over a SQL database — the primary key, not a prior read, decides who was first. @public */
export function createNonceStore(db: D1Client, options: NonceStoreOptions = {}): NonceStore {
  if (options.prefix === "") {
    throw new Error(
      "createNonceStore: `prefix` must not be an empty string — an empty prefix drops the separator too, so the store shares a keyspace with every other store on the binding.",
    );
  }
  const prefix = options.prefix ?? DEFAULT_PREFIX;

  return {
    // `DO NOTHING` and never a conditional update: a consumed key stays consumed past its expiry,
    // so an unpurged row can only refuse a replay, never admit one.
    async markConsumed(key, ttlSeconds) {
      const outcome = await db.execute(
        sql`INSERT INTO auth_nonces (key, expires_at) VALUES (${ephemeralKey(prefix, key)}, ${ephemeralExpiry(ttlSeconds)})
            ON CONFLICT (key) DO NOTHING`,
      );
      return outcome.ok ? ok(outcome.data.rowsWritten > 0) : err(storeError("nonces.markConsumed", outcome.error));
    },
  };
}
