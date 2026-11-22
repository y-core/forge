import type { Middleware } from "@remix-run/fetch-router";
import type { Session, SessionStorage } from "@remix-run/session";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { guardResolverEnv } from "../context/env-memo";
import { getAppContext } from "../context/types";
import { assertUnwrappedKeyRing } from "../crypto/keyring/resolver";
import { createSignedCookie } from "./cookie";
import { assertKVSessionTtl, createKVSessionStorage } from "./kv-storage";
import { brandSessionMiddleware, sessionMiddleware } from "./session";
import type { AnonymousSessionOptions, SessionMiddleware } from "./types";

const DEFAULT_MAX_AGE = 60 * 60 * 24 * 365;

function withoutDeleteId(session: Session): Session {
  return new Proxy(session, {
    get(target, prop) {
      if (prop === "deleteId") return undefined;
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// Upstream cookie storage has no record to delete, so on `regenerateId(true)` it can only `console.warn` the old session id.
function createQuietCookieSessionStorage(): SessionStorage {
  const storage = createCookieSessionStorage();
  return { read: (cookie) => storage.read(cookie), save: (session) => storage.save(withoutDeleteId(session)) };
}

/** Anonymous per-visitor session middleware over a signed id cookie, with data in KV or in the cookie. @public */
export function createAnonymousSession<Bindings = Record<string, unknown>>(options: AnonymousSessionOptions<Bindings>): SessionMiddleware {
  assertUnwrappedKeyRing("createAnonymousSession", options.ring);
  const cookieName = options.cookieName ?? "__Host-session";
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  // An empty name is the one path to `SetCookie.toString()` returning `""`, i.e. an empty header.
  if (cookieName === "") {
    throw new Error("createAnonymousSession: cookieName must not be empty");
  }
  // Cookie storage is a stated choice, never what omitting `kv` falls back to: its session data rides
  // on every request and cannot be revoked before the cookie expires, which nobody opts into silently.
  if (options.kv === undefined && options.storage === undefined) {
    throw new Error('createAnonymousSession: pass `kv` to hold session data server-side, or `storage: "cookie"` to serialize it into the cookie');
  }
  if (options.kv !== undefined && options.storage !== undefined) {
    throw new Error('createAnonymousSession: pass either `kv` or `storage: "cookie"`, not both');
  }
  const ttlSeconds = options.ttlSeconds ?? maxAge;
  if (options.kv !== undefined)
    assertKVSessionTtl("createAnonymousSession", options.ttlSeconds === undefined ? "maxAge" : "ttlSeconds", ttlSeconds);
  // Keyed on `env` identity, never on `(cookieName, secure, ring)`: the cached middleware closes
  // over one tenant's KV namespace, so a value-keyed cache would serve tenant A's sessions to B.
  const cache = new WeakMap<object, Middleware>();

  return brandSessionMiddleware(async (context, next) => {
    const c = getAppContext<Bindings>(context);
    const envObj: unknown = c.env;
    const cacheKey = envObj !== null && typeof envObj === "object" ? (envObj as object) : null;

    const hit = cacheKey ? cache.get(cacheKey) : undefined;
    if (hit) return hit(context, next);

    const env = guardResolverEnv(c.env);
    const ring = await options.ring(env);
    const cookie = createSignedCookie(cookieName, { ring, sameSite: "Lax", maxAge });
    const storage = options.kv
      ? createKVSessionStorage(options.kv(env), { ...(options.prefix !== undefined ? { prefix: options.prefix } : {}), ttlSeconds })
      : createQuietCookieSessionStorage();
    // `rotating` is not passed on: the cookie carries the ring, so the middleware derives it.
    const mw = sessionMiddleware(storage, cookie, options);
    // No env to key on: build per request rather than share one instance across unrelated envs.
    if (cacheKey) cache.set(cacheKey, mw);
    return mw(context, next);
  }, maxAge);
}
