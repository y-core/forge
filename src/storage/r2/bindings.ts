import type { Middleware } from "@remix-run/fetch-router";
import { validateBindings } from "../../app/env";
import type { AppContext } from "../../context/types";
import { v } from "../../validation/mod";
import { r2Backend } from "./r2-backend";
import { createObjectStore } from "./store";
import type { ObjectStore, R2BindingOptions, R2Bucket, R2BucketLike } from "./types";

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
 *
 * @remarks
 * A missing binding is a deployment defect (startup invariant), so this **throws**
 * `Error("R2 bucket binding not available")` rather than returning a `Result` —
 * fail closed, per ERROR_HANDLING.md §5e. Pass `required: false` to opt into a `null`
 * return for non-security-critical features. Operations on the resolved store return
 * `Result<T, E>`: resolution throws, operation failures do not. @public
 */
export function resolveObjectStore<Bindings = Record<string, unknown>, B extends R2BucketLike = R2Bucket>(
  c: AppContext<Bindings>,
  opts: R2BindingOptions<Bindings, B>,
): ObjectStore | null {
  const bucket = opts.binding(c);
  if (!bucket) {
    if (opts.required === false) return null;
    throw new Error("R2 bucket binding not available");
  }
  return createObjectStore(r2Backend(bucket), opts.store);
}
