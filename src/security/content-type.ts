import type { MiddlewareHandler } from "hono";

/** Middleware that rejects requests whose Content-Type is not a form encoding (415). @public */
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
