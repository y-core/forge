import type { Context, Env, MiddlewareHandler } from "hono";
import { validateBindings } from "../../app/env";
import { v } from "../../validation/mod";
import { r2Backend } from "./r2-backend";
import type { ObjectStore, ObjectStoreOptions } from "./store";
import { createObjectStore } from "./store";
import type { R2Bucket } from "./types";

/** Options for resolving an R2 binding from Hono context. @public */
export interface R2BindingOptions<E extends Env = Env> {
  binding: (c: Context<E>) => R2Bucket | undefined;
  /** When true (default), throws if the binding is absent. Set false to return null instead. */
  required?: boolean;
  store?: ObjectStoreOptions;
}

/**
 * Middleware that validates an R2 bucket binding exists on first request.
 * Pass the Wrangler binding name (e.g. "MY_BUCKET"). @public
 */
export function validateR2Binding(name: string): MiddlewareHandler {
  return validateBindings(
    v.object({
      [name]: v.pipe(
        v.unknown(),
        v.check(
          (val) => typeof val === "object" && val !== null,
          `${name} must be an R2 bucket binding`,
        ),
      ),
    }),
  );
}

/**
 * Resolves an ObjectStore from the current request context using an R2 backend.
 * Returns null when binding is absent and `required` is false; throws otherwise. @public
 */
export function resolveObjectStore<E extends Env = Env>(
  c: Context<E>,
  opts: R2BindingOptions<E>,
): ObjectStore | null {
  const bucket = opts.binding(c);
  if (!bucket) {
    if (opts.required === false) return null;
    throw new Error("R2 bucket binding not available");
  }
  return createObjectStore(r2Backend(bucket), opts.store);
}
