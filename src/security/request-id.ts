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
 * `trustCfHeaders: true` to reuse `CF-Ray` (falling back to a UUID when it is blank or absent).
 *
 * @param options - When `trustCfHeaders` is `true`, use the inbound `CF-Ray` header (or a generated
 *   UUID when it is blank or absent). Defaults to `false` (always generate a UUID).
 * @public
 */
export function requestId(options?: { trustCfHeaders?: boolean }): Middleware {
  const trustCfHeaders = options?.trustCfHeaders === true;
  return (context, next) => {
    const forwarded = trustCfHeaders ? context.request.headers.get("CF-Ray") : null;
    // A blank header is treated as absent, not adopted: `??` alone would let a client-supplied
    // empty `CF-Ray` become the request id, so every log line and echoed header would carry "".
    // A non-blank value is used exactly as sent — trimming here would silently rewrite the id.
    const id = forwarded?.trim() ? forwarded : crypto.randomUUID();
    requestIdCtx.set(context, id);
    setPendingHeader(context, "x-request-id", id);
    return next();
  };
}
