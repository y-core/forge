import type { Middleware } from "@remix-run/fetch-router";
import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";

/** Typed accessor for the request ID variable set by `requestId` middleware. @public */
export const requestIdCtx = contextVar<string>("requestId");

/**
 * Middleware that propagates CF-Ray (or a generated UUID) as the request ID.
 *
 * @remarks
 * Off Cloudflare, `CF-Ray` is client-supplied and untrusted — treat the echoed value as a
 * correlation hint only, not a verified origin.
 *
 * @public
 */
export function requestId(): Middleware {
  return (context, next) => {
    const id = context.request.headers.get("CF-Ray") ?? crypto.randomUUID();
    requestIdCtx.set(context, id);
    setPendingHeader(context, "x-request-id", id);
    return next();
  };
}
