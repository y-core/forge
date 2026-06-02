import type { Context, Env } from "hono";

/** A type-safe accessor pair bound to one Hono context-variable key. @public */
export interface ContextVar<T> {
  /** Reads the variable; `undefined` if no middleware has set it on this request. */
  get<E extends Env>(c: Context<E>): T | undefined;
  /** Sets the variable for this request. */
  set<E extends Env>(c: Context<E>, value: T): void;
}

/** Binds a key name and value type into one source of truth so a variable's set and get can never
 *  drift. The single unavoidable cast for untyped key access lives here, not at each call site.
 *  Methods are generic over the env so any `Context<E>` is accepted (Hono's `Context` is invariant
 *  in `E`). @public */
export function contextVar<T>(key: string): ContextVar<T> {
  return {
    get: (c) => (c as unknown as Context<{ Variables: Record<string, unknown> }>).get(key) as T | undefined,
    set: (c, value) => (c as unknown as Context<{ Variables: Record<string, unknown> }>).set(key, value),
  };
}
