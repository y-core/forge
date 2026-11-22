import type { RequestContext } from "@remix-run/fetch-router";

import { memoizePerEnv } from "../../context/env-memo";
import type { KeyRing, KeyRingResolver } from "./types";
import { keyRingResolverBrand } from "./types";

/** Wraps `resolve` so its ring is resolved once per `env` object, retrying after a rejection. @public */
export function createKeyRingResolver<Bindings>(
  resolve: KeyRingResolver<Bindings>,
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings vary per consumer
): ((c: RequestContext<any, any>) => Promise<KeyRing>) & { readonly [keyRingResolverBrand]: true } {
  return Object.assign(memoizePerEnv(resolve), { [keyRingResolverBrand]: true as const });
}

/** Throws when `ring` is `createKeyRingResolver`'s wrapper, which a `ring` option would hand the `env` in place of a request. @internal */
export function assertUnwrappedKeyRing(caller: string, ring: unknown): void {
  if (typeof ring === "function" && keyRingResolverBrand in ring) {
    throw new Error(`${caller}: pass the \`(env) => importKeyRing(…)\` function itself, not \`createKeyRingResolver(…)\``);
  }
}
