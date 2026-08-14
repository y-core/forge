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

/** Anonymous per-visitor session middleware over a signed id cookie, with data in KV or in the cookie. @public */
export function createAnonymousSession<Bindings = Record<string, unknown>>(options: AnonymousSessionOptions<Bindings>): Middleware {
  const cookieName = options.cookieName ?? "__session";
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  // Keyed on `env` identity, never on `(cookieName, secure, secret)`: the cached middleware closes
  // over one tenant's KV namespace, so a value-keyed cache would serve tenant A's sessions to B.
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
    // The `secure: false` branch relaxes ONLY the Secure attribute; it stays signed and httpOnly,
    // and it exists because createSignedCookie deliberately cannot express that.
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
    // No env to key on: build per request rather than share one instance across unrelated envs.
    if (cacheKey) cache.set(cacheKey, mw);
    return mw(context, next);
  };
}
