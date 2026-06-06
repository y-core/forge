import type { RequestContext } from "@remix-run/fetch-router";
import { createContextKey } from "@remix-run/fetch-router";
import type { ContextKey, ContextVar } from "./types";

/** Binds a key and value type into one source of truth so get and set can never drift. @public */
export function contextVar<T>(name: string): ContextVar<T> {
  const key = createContextKey<T>() as ContextKey<T>;
  return {
    key,
    // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for context-variable access
    get(c: RequestContext<any, any>, message?) {
      const value = c.get(key as object) as T | undefined;
      if (value === undefined) {
        throw new Error(message ?? `Context variable "${name}" is not set`);
      }
      return value;
    },
    // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for context-variable access
    set(c: RequestContext<any, any>, value: T) {
      c.set(key as object, value as unknown);
    },
    // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for context-variable access
    getOptional(c: RequestContext<any, any>) {
      return c.get(key as object) as T | undefined;
    },
  };
}
