import type { Context, Env, MiddlewareHandler } from "hono";
import { validateBindings } from "../../app/env";
import { v } from "../../validation/mod";
import { createKVStore } from "./store";
import type { KVNamespace, KVStore, KVStoreOptions } from "./types";

/** Options for resolving a KV binding from Hono context. @public */
export interface KVBindingOptions<E extends Env = Env, T = unknown> {
  binding: (c: Context<E>) => KVNamespace | undefined;
  /** When true (default), throws if the binding is absent. Set false to return null instead. */
  required?: boolean;
  store?: KVStoreOptions<T>;
}

/**
 * Middleware that validates a KV namespace binding exists on first request.
 * Pass the Wrangler binding name (e.g. "MY_KV"). @public
 */
export function validateKVBinding(name: string): MiddlewareHandler {
  return validateBindings(
    v.object({
      [name]: v.pipe(
        v.unknown(),
        v.check(
          (val) => typeof val === "object" && val !== null,
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
export function resolveKVStore<E extends Env = Env, T = unknown>(
  c: Context<E>,
  opts: KVBindingOptions<E, T>,
): KVStore<T> | null {
  const ns = opts.binding(c);
  if (!ns) {
    if (opts.required === false) return null;
    throw new Error("KV namespace binding not available");
  }
  return createKVStore<T>(ns, opts.store);
}
