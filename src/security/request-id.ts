import type { MiddlewareHandler } from "hono";
import { contextVar } from "../context/accessor";

/** Bare variable record set by `requestId`. Intersect into `AppEnv.Variables`. @public */
export type RequestIdContext = { requestId: string };

/** Typed accessor for the request ID variable set by `requestId` middleware. @public */
export const requestIdCtx = contextVar<string>("requestId");

/** Middleware that propagates CF-Ray (or a generated UUID) as the request ID. @public */
export function requestId(): MiddlewareHandler<{ Variables: RequestIdContext }> {
  return async (c, next) => {
    const id = c.req.header("CF-Ray") ?? crypto.randomUUID();
    requestIdCtx.set(c, id);
    c.header("X-Request-Id", id);
    return next();
  };
}
