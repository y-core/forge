import type { RequestContext } from "@remix-run/fetch-router";
import { createContextKey } from "@remix-run/fetch-router";

import { requestScope } from "#request-scope";

import type { ContextKey, ContextVar } from "./types";

/** Binds a key and value type into one source of truth so get and set can never drift. @public */
export function contextVar<T>(name: string): ContextVar<T> {
  const key: ContextKey<T> = createContextKey<T>();
  return {
    key,
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
    get(c: RequestContext<any, any>, message?) {
      const value = requestScope.read(c, key);
      if (value === undefined) {
        throw new Error(message ?? `Context variable "${name}" is not set`);
      }
      return value;
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
    set(c: RequestContext<any, any>, value: T) {
      requestScope.write(c, key, value);
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
    getOptional(c: RequestContext<any, any>) {
      return requestScope.read(c, key);
    },
  };
}
