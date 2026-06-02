import type { Context, Env } from "hono";

/** A type-safe accessor pair bound to one Hono context-variable key. @public */
export interface ContextVar<T> {
  /** Reads the variable; throws if no middleware has set it on this request.
   *  Use when middleware order guarantees the value — a missing value is a bug, not a
   *  runtime condition. `message` overrides the default key-named error. */
  get<E extends Env>(c: Context<E>, message?: string): T;
  /** Sets the variable for this request. */
  set<E extends Env>(c: Context<E>, value: T): void;
  /** Reads the variable; `undefined` if no middleware has set it on this request.
   *  Use only where absence is an expected runtime condition, not a bug. */
  getOptional<E extends Env>(c: Context<E>): T | undefined;
}

/** Binds a key name and value type into one source of truth so a variable's set and get can never
 *  drift. The single unavoidable cast for untyped key access lives here, not at each call site.
 *  Methods are generic over the env so any `Context<E>` is accepted (Hono's `Context` is invariant
 *  in `E`). @public */
export function contextVar<T>(key: string): ContextVar<T> {
  return {
    get: (c, message) => {
      const value = (c as unknown as Context<{ Variables: Record<string, unknown> }>).get(key) as T | undefined;
      if (value === undefined) {
        throw new Error(message ?? `Context variable "${key}" is not set`);
      }
      return value as T;
    },
    set: (c, value) => (c as unknown as Context<{ Variables: Record<string, unknown> }>).set(key, value),
    getOptional: (c) => (c as unknown as Context<{ Variables: Record<string, unknown> }>).get(key) as T | undefined,
  };
}
