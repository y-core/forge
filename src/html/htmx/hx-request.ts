import type { RequestContext } from "@remix-run/fetch-router";

/**
 * Returns true when the request carries an `HX-Request: true` header.
 *
 * @remarks
 * A routing hint, **not a security boundary**. `HX-Request` is a client-supplied header that any
 * caller (curl, a bot, an attacker) can set or omit, so it must never gate access or authorize a
 * mutation. Use it only to branch between a full-page and a partial response. For mutation routes,
 * pair real enforcement — `originProtection`/`crossOriginProtection` (`@y-core/forge/security`)
 * and `csrfProtection` (`@y-core/forge/form`) — alongside it.
 *
 * @public
 */
// biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for header inspection
export function isHxRequest(c: RequestContext<any, any>): boolean {
  return c.request.headers.get("HX-Request") === "true";
}
