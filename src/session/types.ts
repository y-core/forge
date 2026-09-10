import type { CookieOptions } from "@remix-run/cookie";

import type { AppContext } from "../context/types";

/** Options for `createAnonymousSession`. @public */
export interface AnonymousSessionOptions<Bindings = Record<string, unknown>> extends KVSessionStorageOptions {
  cookieName?: string;
  /** Resolves the signing secret from the request env; secrets shorter than 32 characters throw. */
  secret: (c: AppContext<Bindings>) => string;
  /** Resolves the KV binding; when omitted, all session data is serialized into the cookie. */
  kv?: (c: AppContext<Bindings>) => SessionKVBinding;
  /** Set `false` ONLY for plain-http test servers; the cookie stays signed, httpOnly and SameSite=Lax. */
  secure?: boolean | ((c: AppContext<Bindings>) => boolean);
  /** Cookie lifetime in seconds; also the default KV TTL when `ttlSeconds` is not set. */
  maxAge?: number;
}

/** Minimal structural KV surface the session store needs; any Workers `KVNamespace` satisfies it. @public */
export interface SessionKVBinding {
  get(key: string, options: { type: "text" }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Options for `createKVSessionStorage`. @public */
export interface KVSessionStorageOptions {
  /** KV key prefix; the stored key is `${prefix}:${session.id}`. */
  prefix?: string;
  /** KV expiration TTL in seconds, refreshed (sliding) on every save. */
  ttlSeconds?: number;
}

/** Options for `createSignedCookie`, minus the flags it fixes itself. @public */
export type SignedCookieOptions = Omit<CookieOptions, "httpOnly" | "secure" | "secrets"> & {
  secrets: [string, ...string[]];
  sameSite?: "Strict" | "Lax";
};
