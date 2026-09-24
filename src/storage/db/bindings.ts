import type { Middleware } from "@remix-run/fetch-router";

import { bindingSchema, validateBindings } from "../../context/env-validation";
import type { AppContext } from "../../context/types";
import { createD1Client } from "./client";
import type { D1BindingOptions, D1Client, D1Database, D1DatabaseLike } from "./types";

/** Middleware that validates a D1 database binding exists on first request. @public */
export function validateD1Binding(name: string): Middleware {
  return validateBindings(bindingSchema(name, ["prepare"], "a D1 database binding"));
}

/** Resolves a D1Client from the current request context. @public */
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
