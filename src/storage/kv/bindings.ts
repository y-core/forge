import type { Middleware } from "@remix-run/fetch-router";
import { validateBindings } from "../../context/env-validation";
import type { AppContext } from "../../context/types";
import { v } from "../../validation/mod";
import { createKVStore } from "./store";
import type { KVBindingOptions, KVNamespace, KVNamespaceLike, KVStore } from "./types";

/** Middleware that validates a KV namespace binding exists on first request. @public */
export function validateKVBinding(name: string): Middleware {
  return validateBindings(
    v.object({
      [name]: v.pipe(
        v.unknown(),
        v.check(
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

/** Resolves a KVStore from the current request context. @public */
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
