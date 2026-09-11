import type { Middleware } from "@remix-run/fetch-router";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { getAppContext } from "../context/types";
import { createSignedCookie } from "./cookie";
import { createKVSessionStorage } from "./kv-storage";
import { sessionMiddleware } from "./session";
import type { AnonymousSessionOptions } from "./types";

const DEFAULT_MAX_AGE = 60 * 60 * 24 * 365;

/** Anonymous per-visitor session middleware over a signed id cookie, with data in KV or in the cookie. @public */
export function createAnonymousSession<Bindings = Record<string, unknown>>(options: AnonymousSessionOptions<Bindings>): Middleware {
  const cookieName = options.cookieName ?? "__session";
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  // An empty name is the one path to `SetCookie.toString()` returning `""`, i.e. an empty header.
  if (cookieName === "") {
    throw new Error("createAnonymousSession: cookieName must not be empty");
  }
  // Keyed on `env` identity, never on `(cookieName, secure, secret)`: the cached middleware closes
  // over one tenant's KV namespace, so a value-keyed cache would serve tenant A's sessions to B.
  const cache = new WeakMap<object, Middleware>();

  return async (context, next) => {
    const c = getAppContext<Bindings>(context);
    const envObj: unknown = c.env;
    const cacheKey = envObj !== null && typeof envObj === "object" ? (envObj as object) : null;

    const hit = cacheKey ? cache.get(cacheKey) : undefined;
    if (hit) return hit(context, next);

    const resolved = options.secret(c);
    const secrets: [string, ...string[]] = typeof resolved === "string" ? [resolved] : resolved;
    // Per element, never `secrets.length`: on the array arm that would measure the rotation's size
    // rather than a secret, and a valid two-secret rotation would throw "got 2".
    for (const secret of secrets) {
      if (secret.length < 32) {
        throw new Error(`createAnonymousSession: session secret must be at least 32 characters (got ${secret.length})`);
      }
    }
    const cookie = createSignedCookie(cookieName, { secrets, sameSite: "Lax", maxAge });
    const storage = options.kv
      ? createKVSessionStorage(options.kv(c), {
          ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
          ttlSeconds: options.ttlSeconds ?? maxAge,
        })
      : createCookieSessionStorage();
    // `rotating` is not passed on: the cookie carries the secrets, so the middleware derives it.
    const mw = sessionMiddleware(storage, cookie, options);
    // No env to key on: build per request rather than share one instance across unrelated envs.
    if (cacheKey) cache.set(cacheKey, mw);
    return mw(context, next);
  };
}
