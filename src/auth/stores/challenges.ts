import { err, ok } from "../../result/result";
import { jsonCodec } from "../../storage/kv/codec";
import { createKVStore } from "../../storage/kv/store";
import type { KVNamespaceLike } from "../../storage/kv/types";
import { AuthStoreError } from "../errors";
import type { AuthChallenge, ChallengeStore } from "../types";
import { assertKvTtl } from "./ttl";
import type { ChallengeStoreOptions } from "./types";

const DEFAULT_PREFIX = "auth:challenge";

/** Creates a KV-backed `ChallengeStore`, which is right because a challenge is ephemeral and TTL-bounded. @public */
export function createChallengeStore(namespace: KVNamespaceLike, options: ChallengeStoreOptions = {}): ChallengeStore {
  if (options.prefix === "") {
    throw new Error(
      "createChallengeStore: `prefix` must not be an empty string — an empty prefix drops the separator too, so the store shares a keyspace with every other store on the binding.",
    );
  }
  const store = createKVStore<AuthChallenge>(namespace, { prefix: options.prefix ?? DEFAULT_PREFIX, codec: jsonCodec<AuthChallenge>() });

  return {
    async put(key, challenge, ttlSeconds) {
      assertKvTtl("challenges.put", ttlSeconds, "challenge");
      const outcome = await store.set(key, challenge, { ttl: ttlSeconds });
      return outcome.ok ? ok() : err(new AuthStoreError("unavailable", "challenges.put", { cause: outcome.error }));
    },

    async take(key) {
      const read = await store.get(key);
      if (!read.ok) return err(new AuthStoreError("unavailable", "challenges.take", { cause: read.error }));
      if (read.data === null) return ok(null);
      const removed = await store.delete(key);
      if (!removed.ok) return err(new AuthStoreError("unavailable", "challenges.take", { cause: removed.error }));
      return ok(read.data);
    },
  };
}
