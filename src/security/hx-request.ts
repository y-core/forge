import type { Context } from "hono";

/** Returns true when the request carries an HX-Request: true header. Use as a routing hint, not a security boundary. @public */
export function isHxRequest(c: Context): boolean {
  return c.req.header("HX-Request") === "true";
}
