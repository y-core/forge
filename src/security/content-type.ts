import type { MiddlewareHandler } from "hono";

export function requireFormContentType(): MiddlewareHandler {
  return async (c, next) => {
    const ct = c.req.header("content-type") ?? "";
    const base = ct.split(";")[0].trim();
    if (
      base !== "application/x-www-form-urlencoded" &&
      base !== "multipart/form-data"
    ) {
      return c.text("Unsupported Media Type", 415);
    }
    return next();
  };
}
