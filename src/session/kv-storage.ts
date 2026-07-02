import type { SessionStorage } from "@remix-run/session";
import { createSession } from "@remix-run/session";

/** The `[values, flash]` tuple `Session` persists — not exported upstream, so derived. */
type SessionData = NonNullable<Parameters<typeof createSession>[1]>;

/**
 * Minimal structural KV surface the session store needs — keeps `session` a leaf namespace
 * (no `storage/kv` import); any Workers `KVNamespace` binding satisfies it. @public
 */
export interface SessionKVBinding {
  get(key: string, options: { type: "text" }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Options for `createKVSessionStorage`. @public */
export interface KVSessionStorageOptions {
  /** KV key prefix; the stored key is `${prefix}:${session.id}`. @defaultValue "session" */
  prefix?: string;
  /** KV expiration TTL in seconds, refreshed (sliding) on every save. @defaultValue 31536000 (1 year) */
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 365;

/**
 * `SessionStorage` backed by Workers KV — the durable sibling of `createMemorySessionStorage`.
 * The session cookie carries **only the opaque session id**; all session data lives in KV under
 * that id with a sliding TTL. Compared to cookie storage this removes the ~4 KB size limit,
 * keeps data out of the client entirely, and makes server-side revocation possible
 * (delete the KV key).
 *
 * Mirrors the upstream storage contract exactly: `read` never throws (unknown ids and corrupt
 * records yield a fresh session); `save` returns the id when dirty, `""` when destroyed
 * (clearing the cookie), and `null` when unchanged (no Set-Cookie).
 *
 * @example
 * ```typescript
 * const storage = createKVSessionStorage(c.env.SESSIONS_KV, { ttlSeconds: 60 * 60 * 24 * 30 });
 * app.use("*", sessionMiddleware(storage, sessionCookie));
 * ```
 * @public
 */
export function createKVSessionStorage(kv: SessionKVBinding, options?: KVSessionStorageOptions): SessionStorage {
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
        // Corrupt record — fail soft with a fresh session rather than breaking the request.
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
