import { err, ok } from "../../result/result";
import { sql } from "../../storage/db/sql";
import type { D1Client } from "../../storage/db/types";
import type { AuthChallenge, ChallengeStore } from "../types";
import { ephemeralKey, ephemeralExpiry } from "./ephemera";
import { readRow, storeError } from "./rows";
import type { ChallengeStoreOptions } from "./types";

const DEFAULT_PREFIX = "auth:challenge";

/** Creates the `ChallengeStore` over a SQL database — `take` reads and spends in one statement. @public */
export function createChallengeStore(db: D1Client, options: ChallengeStoreOptions = {}): ChallengeStore {
  if (options.prefix === "") {
    throw new Error(
      "createChallengeStore: `prefix` must not be an empty string — an empty prefix drops the separator too, so the store shares a keyspace with every other store on the binding.",
    );
  }
  const prefix = options.prefix ?? DEFAULT_PREFIX;

  return {
    async put(key, challenge, ttlSeconds) {
      const outcome = await db.execute(
        sql`INSERT INTO auth_challenges (key, value, expires_at)
            VALUES (${ephemeralKey(prefix, key)}, ${JSON.stringify(challenge)}, ${ephemeralExpiry(ttlSeconds)})
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      );
      return outcome.ok ? ok() : err(storeError("challenges.put", outcome.error));
    },

    // One statement, so two requests cannot each be handed the same challenge: whichever `DELETE`
    // matches the row is the only one `RETURNING` answers a value to.
    async take(key) {
      const outcome = await db.queryOne<{ value: string }>(
        sql`DELETE FROM auth_challenges WHERE key = ${ephemeralKey(prefix, key)} AND expires_at > ${Date.now()} RETURNING value`,
      );
      if (!outcome.ok) return err(storeError("challenges.take", outcome.error));
      const row = outcome.data;
      return row === null ? ok(null) : readRow("challenges.take", () => JSON.parse(row.value) as AuthChallenge);
    },
  };
}
