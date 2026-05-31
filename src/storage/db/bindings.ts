import type { Context, Env, MiddlewareHandler } from "hono";
import { validateBindings } from "../../app/env";
import { v } from "../../validation/mod";
import type { D1Client, D1ClientOptions } from "./client";
import { createD1Client } from "./client";
import type { D1Database } from "./types";

/** Options for resolving a D1 binding from Hono context. @public */
export interface D1BindingOptions<E extends Env = Env> {
  binding: (c: Context<E>) => D1Database | undefined;
  /** When true (default), throws if the binding is absent. Set false to return null instead. */
  required?: boolean;
  client?: D1ClientOptions;
}

/**
 * Middleware that validates a D1 database binding exists on first request.
 * Pass the Wrangler binding name (e.g. "DB"). @public
 */
export function validateD1Binding(name: string): MiddlewareHandler {
  return validateBindings(
    v.object({
      [name]: v.pipe(
        v.unknown(),
        v.check(
          (val) => typeof val === "object" && val !== null,
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
export function resolveD1Client<E extends Env = Env>(
  c: Context<E>,
  opts: D1BindingOptions<E>,
): D1Client | null {
  const db = opts.binding(c);
  if (!db) {
    if (opts.required === false) return null;
    throw new Error("D1 database binding not available");
  }
  return createD1Client(db, opts.client);
}
