import type { AppContext } from "../context/types";

/** Options for `sessionMiddleware`. @public */
export interface SessionCookieOptions {
  /** Re-issues the cookie on every request that carries one — the only way to push changed attributes (`Secure`, `SameSite`, `Path`, `Max-Age`) to clients holding a valid session; a deploy-window setting, since it makes every such response uncacheable. */
  reissue?: boolean;
  /** Overrides the cookie's own `rotating`: on, an unchanged session is re-signed so the wire bytes can be compared, which is what upgrades a cookie still carrying a retired signature; off, it costs no HMAC and a retired signature is left in place. */
  rotating?: boolean;
}

/** Options for `createAnonymousSession`. @public */
export interface AnonymousSessionOptions<Bindings = Record<string, unknown>> extends KVSessionStorageOptions, SessionCookieOptions {
  cookieName?: string;
  /** Resolves the signing secret, or a rotation array whose first element signs, from the request env; secrets shorter than 32 characters throw. */
  secret: (c: AppContext<Bindings>) => string | [string, ...string[]];
  /** Resolves the KV binding; when omitted, all session data is serialized into the cookie. */
  kv?: (c: AppContext<Bindings>) => SessionKVBinding;
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

/** `Set-Cookie` attributes, as defaults at construction or as a per-call override on `serialize`. @public */
export interface CookieAttributes {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  partitioned?: boolean;
  path?: string;
  sameSite?: "Strict" | "Lax" | "None";
  secure?: boolean;
}

/** A cookie whose value is carried verbatim, base64-encoded but unauthenticated. @public */
export interface UnsignedCookie {
  readonly name: string;
  /** Reads this cookie's value out of a `Cookie` header, answering `null` when it is absent or malformed; never throws. */
  parse(header: string | null): Promise<string | null>;
  /** Builds the `Set-Cookie` header value, merging `attributes` over the construction-time defaults. */
  serialize(value: string, attributes?: CookieAttributes): Promise<string>;
}

/** A cookie whose value is HMAC-signed, verified against every secret on the way in. @public */
export interface SignedCookie extends UnsignedCookie {
  /** True while more than one secret is held, i.e. a rotation is in flight. */
  readonly rotating: boolean;
}

/** Options for `createSignedCookie`, minus the flags it fixes itself. @public */
export interface SignedCookieOptions extends Omit<CookieAttributes, "httpOnly" | "sameSite" | "secure"> {
  /** The first secret signs; every one of them verifies, so a rotation keeps existing cookies valid. Each must be at least 32 characters. */
  secrets: [string, ...string[]];
  sameSite?: "Strict" | "Lax";
}

/** Options for `createUnsignedCookie`. @public */
export interface UnsignedCookieOptions extends CookieAttributes {}
