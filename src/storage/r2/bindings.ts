import type { Middleware } from "@remix-run/fetch-router";
import { validateBindings } from "../../app/env";
import type { AppContext } from "../../context/types";
import { v } from "../../validation/mod";
import { r2Backend } from "./r2-backend";
import { createObjectStore } from "./store";
import type { ObjectStore, R2BindingOptions } from "./types";

/**
 * Middleware that validates an R2 bucket binding exists on first request.
 * Pass the Wrangler binding name (e.g. "MY_BUCKET"). @public
 */
export function validateR2Binding(name: string): Middleware {
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
export function resolveObjectStore<Bindings = Record<string, unknown>>(
  c: AppContext<Bindings>,
  opts: R2BindingOptions<Bindings>,
): ObjectStore | null {
  const bucket = opts.binding(c);
  if (!bucket) {
    if (opts.required === false) return null;
    throw new Error("R2 bucket binding not available");
  }
  return createObjectStore(r2Backend(bucket), opts.store);
}
