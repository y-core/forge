import { createCookie } from "@remix-run/cookie";
import type { Middleware } from "@remix-run/fetch-router";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";
import type { AppContext } from "../context/types";
import { getAppContext } from "../context/types";
import type { KVSessionStorageOptions, SessionKVBinding } from "./kv-storage";
import { createKVSessionStorage } from "./kv-storage";
import { sessionMiddleware } from "./session";
import { createSignedCookie } from "./signed";

const DEFAULT_MAX_AGE = 60 * 60 * 24 * 365;

/** Options for `createAnonymousSession`. @public */
export interface AnonymousSessionOptions<Bindings = Record<string, unknown>> extends KVSessionStorageOptions {
  /** Session cookie name. @defaultValue "__session" */
  cookieName?: string;
  /** Resolves the signing secret from the request env (≥ 32 characters — enforced). */
  secret: (c: AppContext<Bindings>) => string;
  /** Resolves the KV binding for server-side session storage. Omitted → cookie storage
   *  (all session data serialized into the cookie — fine for tiny sessions only). */
  kv?: (c: AppContext<Bindings>) => SessionKVBinding;
  /** Cookie `Secure` attribute. Set `false` ONLY for plain-http test servers — browsers drop
   *  `Secure` cookies over http. The cookie stays signed + httpOnly + SameSite=Lax regardless.
   *  @defaultValue true */
  secure?: boolean | ((c: AppContext<Bindings>) => boolean);
  /** Cookie lifetime in seconds; also the default KV TTL when `ttlSeconds` is not set.
   *  @defaultValue 31536000 (1 year) */
  maxAge?: number;
}

/**
 * Anonymous per-visitor session middleware — the production pattern in one factory:
 * a signed, httpOnly, SameSite=Lax cookie carrying **only the opaque session id**, with
 * session data in Workers KV (`kv` given) or serialized into the cookie (`kv` omitted).
 * Handlers persist per-visitor state with plain `session.set(...)` — no manual id
 * bookkeeping or KV keying.
 *
 * Secrets and bindings are resolved from the request env, and the built middleware is cached
 * against **the `env` object itself** via a `WeakMap` — the same scheme `csrfProtection` uses.
 * In Workers production one `env` lives for the isolate's lifetime, so the middleware is built
 * once; a different `env` (another tenant, another test) builds its own.
 *
 * Keying on `env` identity rather than on `(cookieName, secure, secret)` is load-bearing: the
 * cached middleware closes over the **KV namespace** `options.kv(c)` returned for the request
 * that built it. Two tenants sharing a cookie name, secure flag and secret hashed to one cache
 * slot and therefore shared one KV namespace — tenant B reading and writing tenant A's sessions.
 * A `WeakMap` also lets entries be collected, where the old `Map` grew without bound under a
 * rotating secret.
 *
 * @example
 * ```typescript
 * app.use("*", createAnonymousSession<AppEnv>({
 *   cookieName: "app_session",
 *   secret: (c) => c.env.SESSION_SECRET,
 *   kv: (c) => c.env.SESSIONS_KV,
 * }));
 *
 * // In a handler — this is the whole persistence story:
 * const session = sessionCtx.get(c);
 * session.set("settings", parsed.settings);
 * ```
 * @public
 */
export function createAnonymousSession<Bindings = Record<string, unknown>>(options: AnonymousSessionOptions<Bindings>): Middleware {
  const cookieName = options.cookieName ?? "__session";
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  const cache = new WeakMap<object, Middleware>();

  return async (context, next) => {
    const c = getAppContext<Bindings>(context);
    const envObj: unknown = c.env;
    const cacheKey = envObj !== null && typeof envObj === "object" ? (envObj as object) : null;

    const hit = cacheKey ? cache.get(cacheKey) : undefined;
    if (hit) return hit(context, next);

    const secret = options.secret(c);
    const secure = typeof options.secure === "function" ? options.secure(c) : (options.secure ?? true);

    if (secret.length < 32) {
      throw new Error(`createAnonymousSession: session secret must be at least 32 characters (got ${secret.length})`);
    }
    // Default path: createSignedCookie enforces httpOnly + Secure + HMAC signing.
    // secure=false (plain-http test servers only) keeps the cookie signed + httpOnly and
    // relaxes ONLY the Secure attribute — createSignedCookie deliberately cannot do that.
    const cookie = secure
      ? createSignedCookie(cookieName, { secrets: [secret], sameSite: "Lax", maxAge })
      : createCookie(cookieName, { secrets: [secret], httpOnly: true, secure: false, sameSite: "Lax", maxAge });
    const storage = options.kv
      ? createKVSessionStorage(options.kv(c), {
          ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
          ttlSeconds: options.ttlSeconds ?? maxAge,
        })
      : createCookieSessionStorage();
    const mw = sessionMiddleware(storage, cookie);
    // No env object to key on (a bare context outside the Forge chain) → build per request rather
    // than risk sharing one instance across unrelated environments.
    if (cacheKey) cache.set(cacheKey, mw);
    return mw(context, next);
  };
}
