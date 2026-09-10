import type { SessionStorage } from "@remix-run/session";
import { createSession } from "@remix-run/session";

import type { KVSessionStorageOptions, SessionKVBinding } from "./types";

/** The `[values, flash]` tuple `Session` persists — not exported upstream, so derived. */
type SessionData = NonNullable<Parameters<typeof createSession>[1]>;

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 365;

/** `SessionStorage` backed by Workers KV, keyed by the opaque session id under a sliding TTL. @public */
export function createKVSessionStorage(kv: SessionKVBinding, options?: KVSessionStorageOptions): SessionStorage {
  if (options?.prefix === "") {
    throw new Error(
      "createKVSessionStorage: `prefix` must not be an empty string — it leaves every session keyed by a bare `:${id}` in a shared keyspace.",
    );
  }
  const prefix = options?.prefix ?? "session";
  const ttlSeconds = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const keyFor = (id: string) => `${prefix}:${id}`;

  return {
    async read(cookie) {
      if (cookie == null || cookie === "") {
        return createSession();
      }
      const raw = await kv.get(keyFor(cookie), { type: "text" });
      if (raw === null) {
        return createSession();
      }
      try {
        return createSession(cookie, JSON.parse(raw) as SessionData);
      } catch {
        // A corrupt record fails soft: `read` must never throw, per the upstream storage contract.
        return createSession();
      }
    },
    async save(session) {
      if (session.deleteId) {
        await kv.delete(keyFor(session.deleteId));
      }
      if (session.destroyed) {
        await kv.delete(keyFor(session.id));
        return ""; // empty cookie value → the session cookie is cleared
      }
      if (session.dirty) {
        await kv.put(keyFor(session.id), JSON.stringify(session.data), { expirationTtl: ttlSeconds });
        return session.id;
      }
      return null; // unchanged → no Set-Cookie
    },
  };
}
