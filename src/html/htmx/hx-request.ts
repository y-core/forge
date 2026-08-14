import type { RequestContext } from "@remix-run/fetch-router";

/** Returns true when the request carries an `HX-Request: true` header. @public */
// Client-supplied and trivially forged: a routing hint only, never an access gate.
// biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for header inspection
export function isHxRequest(c: RequestContext<any, any>): boolean {
  return c.request.headers.get("HX-Request") === "true";
}
