import type { MiddlewareHandler } from "hono";

/** Bare variable record set by `requestId`. Intersect into `AppEnv.Variables`. @public */
export type RequestIdContext = { requestId: string };

/** Middleware that propagates CF-Ray (or a generated UUID) as the request ID. @public */
export function requestId(): MiddlewareHandler<{ Variables: RequestIdContext }> {
  return async (c, next) => {
    const id = c.req.header("CF-Ray") ?? crypto.randomUUID();
    c.set("requestId", id);
    c.header("X-Request-Id", id);
    return next();
  };
}
