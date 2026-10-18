import type { RequestContext } from "@remix-run/fetch-router";

import type { AppContext } from "../../context/types";
import { EnvKey } from "../../context/types";
import { cachePendingUntilRejected } from "./subkey";
import type { KeyRing, KeyRingResolver } from "./types";

/** Wraps `resolve` so its ring is resolved once per `env` object, retrying after a rejection. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings vary per consumer
export function createKeyRingResolver<Bindings>(resolve: KeyRingResolver<Bindings>): (c: RequestContext<any, any>) => Promise<KeyRing> {
  const cache = new WeakMap<object, Promise<KeyRing>>();
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings vary per consumer
  return async (c: RequestContext<any, any>): Promise<KeyRing> => {
    const env = c.get(EnvKey);
    const run = () => resolve(c as AppContext<Bindings>);
    if (!env || typeof env !== "object") return run();
    return cache.get(env) ?? cachePendingUntilRejected(cache, env, Promise.resolve().then(run));
  };
}
