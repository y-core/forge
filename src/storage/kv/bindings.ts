import type { Middleware } from "@remix-run/fetch-router";
import { validateBindings } from "../../app/env";
import type { AppContext } from "../../context/types";
import { v } from "../../validation/mod";
import { createKVStore } from "./store";
import type { KVBindingOptions, KVNamespace, KVNamespaceLike, KVStore } from "./types";

/**
 * Middleware that validates a KV namespace binding exists on first request.
 * Pass the Wrangler binding name (e.g. "MY_KV"). @public
 */
export function validateKVBinding(name: string): Middleware {
  return validateBindings(
    v.object({
      [name]: v.pipe(
        v.unknown(),
        v.check(
          // Shape check, not mere presence: a string/number bound to this name must be rejected.
          (val) =>
            typeof val === "object" &&
            val !== null &&
            typeof (val as { get?: unknown }).get === "function" &&
            typeof (val as { put?: unknown }).put === "function",
          `${name} must be a KV namespace binding`,
        ),
      ),
    }),
  );
}

/**
 * Resolves a KVStore from the current request context.
 *
 * @remarks
 * A missing binding is a deployment defect (startup invariant), so this **throws**
 * `Error("KV namespace binding not available")` rather than returning a `Result` —
 * fail closed, per ERROR_HANDLING.md §5e. Pass `required: false` to opt into a `null`
 * return for non-security-critical features. Operations on the resolved store return
 * `Result<T, E>`: resolution throws, operation failures do not. @public
 */
export function resolveKVStore<Bindings = Record<string, unknown>, T = unknown, NS extends KVNamespaceLike = KVNamespace>(
  c: AppContext<Bindings>,
  opts: KVBindingOptions<Bindings, T, NS>,
): KVStore<T> | null {
  const ns = opts.binding(c);
  if (!ns) {
    if (opts.required === false) return null;
    throw new Error("KV namespace binding not available");
  }
  return createKVStore<T>(ns, opts.store);
}
