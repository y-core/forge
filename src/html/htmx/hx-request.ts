import type { RequestContext } from "@remix-run/fetch-router";

/** Returns true when the request carries an HX-Request: true header. Use as a routing hint, not a security boundary. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for header inspection
export function isHxRequest(c: RequestContext<any, any>): boolean {
  return c.request.headers.get("HX-Request") === "true";
}
