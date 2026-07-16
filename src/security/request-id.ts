import type { Middleware } from "@remix-run/fetch-router";
import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";

/** Typed accessor for the request ID variable set by `requestId` middleware. @public */
export const requestIdCtx = contextVar<string>("requestId");

/**
 * Middleware that assigns a request ID and echoes it into the `x-request-id` response header.
 *
 * @remarks
 * Default-distrust: unless `trustCfHeaders` is `true`, the inbound `CF-Ray` header is ignored and
 * a fresh `crypto.randomUUID()` is always generated. `CF-Ray` is client-supplied and forgeable off
 * Cloudflare, so it is only adopted when the Worker is known to run behind Cloudflare. Set
 * `trustCfHeaders: true` to reuse `CF-Ray` (falling back to a UUID when it is absent).
 *
 * @param options - When `trustCfHeaders` is `true`, use the inbound `CF-Ray` header (or a generated
 *   UUID when absent). Defaults to `false` (always generate a UUID).
 * @public
 */
export function requestId(options?: { trustCfHeaders?: boolean }): Middleware {
  const trustCfHeaders = options?.trustCfHeaders === true;
  return (context, next) => {
    const id = (trustCfHeaders ? context.request.headers.get("CF-Ray") : null) ?? crypto.randomUUID();
    requestIdCtx.set(context, id);
    setPendingHeader(context, "x-request-id", id);
    return next();
  };
}
