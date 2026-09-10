import { err, ok } from "../../result/result";
import { textCodec } from "../../storage/kv/codec";
import { createKVStore } from "../../storage/kv/store";
import type { KVNamespaceLike } from "../../storage/kv/types";
import { AuthStoreError } from "../errors";
import type { NonceStore } from "../types";
import { assertKvTtl } from "./ttl";
import type { NonceStoreOptions } from "./types";

const DEFAULT_PREFIX = "auth:nonce";

/** The stored value carries nothing — the key's presence is the whole record. */
const CONSUMED = "1";

/** Creates a KV-backed `NonceStore`, which is right because a nonce is ephemeral and TTL-bounded. @public */
export function createNonceStore(namespace: KVNamespaceLike, options: NonceStoreOptions = {}): NonceStore {
  if (options.prefix === "") {
    throw new Error(
      "createNonceStore: `prefix` must not be an empty string — an empty prefix drops the separator too, so the store shares a keyspace with every other store on the binding.",
    );
  }
  const store = createKVStore<string>(namespace, { prefix: options.prefix ?? DEFAULT_PREFIX, codec: textCodec() });

  return {
    async markConsumed(key, ttlSeconds) {
      assertKvTtl("nonces.markConsumed", ttlSeconds, "nonce");
      const read = await store.get(key);
      if (!read.ok) return err(new AuthStoreError("unavailable", "nonces.markConsumed", { cause: read.error }));
      if (read.data !== null) return ok(false);
      const written = await store.set(key, CONSUMED, { ttl: ttlSeconds });
      return written.ok ? ok(true) : err(new AuthStoreError("unavailable", "nonces.markConsumed", { cause: written.error }));
    },
  };
}
