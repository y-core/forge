import type { Middleware } from "@remix-run/fetch-router";
import { validateBindings } from "../../app/env";
import type { AppContext } from "../../context/types";
import { v } from "../../validation/mod";
import { createD1Client } from "./client";
import type { D1BindingOptions, D1Client, D1Database, D1DatabaseLike } from "./types";

/**
 * Middleware that validates a D1 database binding exists on first request.
 * Pass the Wrangler binding name (e.g. "DB"). @public
 */
export function validateD1Binding(name: string): Middleware {
  return validateBindings(
    v.object({
      [name]: v.pipe(
        v.unknown(),
        v.check(
          // Shape check, not mere presence: a string/number bound to this name must be rejected.
          (val) => typeof val === "object" && val !== null && typeof (val as { prepare?: unknown }).prepare === "function",
          `${name} must be a D1 database binding`,
        ),
      ),
    }),
  );
}

/**
 * Resolves a D1Client from the current request context.
 * Returns null when binding is absent and `required` is false; throws otherwise. @public
 */
export function resolveD1Client<Bindings = Record<string, unknown>, DB extends D1DatabaseLike = D1Database>(
  c: AppContext<Bindings>,
  opts: D1BindingOptions<Bindings, DB>,
): D1Client | null {
  const db = opts.binding(c);
  if (!db) {
    if (opts.required === false) return null;
    throw new Error("D1 database binding not available");
  }
  return createD1Client(db, opts.client);
}
