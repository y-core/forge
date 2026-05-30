import type { Child, FC } from "hono/jsx";
import { createContext, useContext } from "hono/jsx";

const MISSING = Symbol("request-context-missing");

/** Creates a typed request-scoped JSX context. The `use()` hook throws if called outside
 *  the Provider, preventing the silent-default footgun of raw `createContext`. @public */
export function createRequestContext<T>(displayName: string): {
  Provider: FC<{ value: T; children: Child }>;
  use: () => T;
} {
  const Ctx = createContext<T | typeof MISSING>(MISSING);
  const Provider: FC<{ value: T; children: Child }> = ({ value, children }) => (
    <Ctx.Provider value={value}>{children}</Ctx.Provider>
  );
  const use = (): T => {
    const v = useContext(Ctx);
    if (v === MISSING) throw new Error(`use${displayName}() used outside its Provider`);
    return v as T;
  };
  return { Provider, use };
}
