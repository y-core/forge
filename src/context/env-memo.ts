import type { RequestContext } from "@remix-run/fetch-router";

import { EnvKey } from "./types";

/** Caches a pending promise under `key`, evicting it on rejection so the next caller retries. @internal */
export function cachePendingUntilRejected<K, T>(
  cache: { get(key: K): Promise<T> | undefined; set(key: K, value: Promise<T>): unknown; delete(key: K): boolean },
  key: K,
  pending: Promise<T>,
): Promise<T> {
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}

const RESOLVER_HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";

/** A view of `env` on which reading `env` or `get`, absent from the real one, throws naming the 0.7.7 rewrite. @internal */
export function guardResolverEnv<Bindings>(env: Bindings): Bindings {
  if (!env || typeof env !== "object") return env;
  return new Proxy(env, {
    get(target, prop) {
      if ((prop === "env" || prop === "get") && !Reflect.has(target, prop)) throw new Error(RESOLVER_HANDED_ENV);
      return Reflect.get(target, prop, target);
    },
  });
}

/** Computes `compute(env)` once per `env` object, retrying after a rejection; it sees no request, so none can leak into the cache. @public */
export function memoizePerEnv<Bindings, T>(
  compute: (env: Bindings) => T | Promise<T>,
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings vary per consumer
): (c: RequestContext<any, any>) => Promise<T> {
  const cache = new WeakMap<object, Promise<T>>();
  return async (c) => {
    const env = c.get(EnvKey) as Bindings;
    if (!env || typeof env !== "object") return compute(env);
    const held = cache.get(env);
    if (held) return held;
    return cachePendingUntilRejected(
      cache,
      env,
      Promise.resolve().then(() => compute(guardResolverEnv(env))),
    );
  };
}
