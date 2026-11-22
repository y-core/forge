import type { ContextKey, RequestScope } from "./types";

/** Reads and writes a request's context directly. @internal */
export const requestScope: RequestScope = {
  read: <T>(c: Parameters<RequestScope["read"]>[0], key: ContextKey<T>) => c.get(key) as T | undefined,
  write: (c, key, value) => {
    c.set(key, value);
  },
};
