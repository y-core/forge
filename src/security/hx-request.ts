import type { MiddlewareHandler } from "hono";

export function requireHxRequest(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("HX-Request") !== "true") {
      return c.text("Forbidden", 403);
    }
    return next();
  };
}
