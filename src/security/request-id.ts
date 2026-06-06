import type { Middleware } from "@remix-run/fetch-router";
import { contextVar } from "../context/accessor";

/** Typed accessor for the request ID variable set by `requestId` middleware. @public */
export const requestIdCtx = contextVar<string>("requestId");

/** Middleware that propagates CF-Ray (or a generated UUID) as the request ID. @public */
export function requestId(): Middleware {
  return async (context, next) => {
    const id = context.request.headers.get("CF-Ray") ?? crypto.randomUUID();
    requestIdCtx.set(context, id);
    const res = await next();
    res.headers.set("X-Request-Id", id);
    return res;
  };
}
