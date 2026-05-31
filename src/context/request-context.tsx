import type { Context } from "hono";
import type { Child, FC } from "hono/jsx";
import { createContext, useContext } from "hono/jsx";
import type { CsrfVariables } from "../form/types";
import type { LoggerVariables } from "../logging/request-logger";

const MISSING = Symbol("request-context-missing");

/** Universal request-scoped values forge hydrates from the Hono context. @public */
export interface RequestBase {
  nonce: string;
  csrfToken: string;
}

type RequestBaseEnv = CsrfVariables & LoggerVariables & { Variables: { secureHeadersNonce?: string } };

/** Reads the CSP nonce and (optionally) mints a CSRF token off the Hono context,
 *  warning when the nonce is empty. @public */
export async function hydrateRequestBase<E extends RequestBaseEnv>(
  c: Context<E>,
  opts?: { csrfPath?: string },
): Promise<RequestBase> {
  const nonce = c.get("secureHeadersNonce") ?? "";
  if (!nonce) c.get("logger")?.warn("secureHeadersNonce is empty — nonce'd inline script will break CSP");
  const mint = c.get("mintCsrfToken");
  const csrfToken = opts?.csrfPath && mint ? await mint(opts.csrfPath) : "";
  return { nonce, csrfToken };
}

/** Creates a typed request-scoped JSX context. The `use()` hook throws if called outside
 *  the Provider, preventing the silent-default footgun of raw `createContext`. @public */
export function createRequestContext<T extends RequestBase>(displayName: string): {
  Provider: FC<{ value: T; children: Child }>;
  use: () => T;
  useNonce: () => string;
  useCsrfToken: () => string;
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
  return {
    Provider,
    use,
    useNonce: () => use().nonce,
    useCsrfToken: () => use().csrfToken,
  };
}
