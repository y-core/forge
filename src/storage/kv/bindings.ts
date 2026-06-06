import type { Middleware } from "@remix-run/fetch-router";
import { validateBindings } from "../../app/env";
import type { AppContext } from "../../context/types";
import { v } from "../../validation/mod";
import { createKVStore } from "./store";
import type { KVBindingOptions, KVNamespace, KVStore, KVStoreOptions } from "./types";

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
 * Returns null when binding is absent and `required` is false; throws otherwise. @public
 */
export function resolveKVStore<Bindings = Record<string, unknown>, T = unknown>(
  c: AppContext<Bindings>,
  opts: KVBindingOptions<Bindings, T>,
): KVStore<T> | null {
  const ns = opts.binding(c);
  if (!ns) {
    if (opts.required === false) return null;
    throw new Error("KV namespace binding not available");
  }
  return createKVStore<T>(ns, opts.store);
}
