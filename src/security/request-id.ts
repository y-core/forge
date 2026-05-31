import type { MiddlewareHandler } from "hono";

/** Merge into your Hono app generic when using `requestId` to type `c.get("requestId")`. @public */
export type RequestIdVariables = { Variables: { requestId: string } };

/** Middleware that propagates CF-Ray (or a generated UUID) as the request ID. @public */
export function requestId(): MiddlewareHandler<RequestIdVariables> {
  return async (c, next) => {
    const id = c.req.header("CF-Ray") ?? crypto.randomUUID();
    c.set("requestId", id);
    c.header("X-Request-Id", id);
    return next();
  };
}
