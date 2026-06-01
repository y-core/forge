import type { Context } from "hono";
import type { CsrfContext } from "../form/types";
import type { LoggerContext } from "../logging/request-logger";
import type { SecureHeadersContext } from "../security/headers";

/** Universal request-scoped values forge hydrates from the Hono context. @public */
export interface RequestBase {
  nonce: string;
  csrfToken: string;
}

type RequestBaseEnv = { Variables: CsrfContext & LoggerContext & SecureHeadersContext };

/** Reads the CSP nonce and (optionally) mints a CSRF token off the Hono context,
 *  warning when the nonce is empty. @public */
export async function hydrateRequestBase<E extends RequestBaseEnv>(
  c: Context<E>,
  opts?: { csrfPath?: string },
): Promise<RequestBase> {
  const nonce = c.get("secureHeadersNonce") ?? "";
  if (!nonce) c.get("logger")?.warn("secureHeadersNonce is empty — nonce'd inline script will break CSP");
  const mint = c.get("mintCsrf");
  const csrfToken = opts?.csrfPath && mint ? await mint(opts.csrfPath) : "";
  return { nonce, csrfToken };
}
