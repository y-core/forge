import type { Middleware } from "@remix-run/fetch-router";
import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";

/** Typed accessor for the request ID variable set by `requestId` middleware. @public */
export const requestIdCtx = contextVar<string>("requestId");

/** Middleware that assigns a request ID and echoes it into the `x-request-id` response header. @public */
export function requestId(options?: { trustCfHeaders?: boolean }): Middleware {
  const trustCfHeaders = options?.trustCfHeaders === true;
  return (context, next) => {
    const forwarded = trustCfHeaders ? context.request.headers.get("CF-Ray") : null;
    // Blank is treated as absent, not adopted: `??` alone would let a client-supplied empty
    // `CF-Ray` become the request id. A non-blank value is used as sent, never trimmed.
    const id = forwarded?.trim() ? forwarded : crypto.randomUUID();
    requestIdCtx.set(context, id);
    setPendingHeader(context, "x-request-id", id);
    return next();
  };
}
