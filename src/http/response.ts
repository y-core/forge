import type { SafeHtml } from "@remix-run/html-template";
import { createHtmlResponse } from "@remix-run/response/html";

/** Re-export of `@remix-run/response`'s redirect helper (also aliased as `redirect`). @public */
export { createRedirectResponse, createRedirectResponse as redirect } from "@remix-run/response/redirect";

/**
 * Constructs a full-page HTML `Response`, guaranteeing a leading `<!DOCTYPE html>` and a
 * `content-type: text/html` header. Accepts a `SafeHtml` value (e.g. from `renderToString`)
 * or a string. For HTMX partials that must NOT carry a DOCTYPE, use `fragmentResponse`.
 *
 * The optional `headers` map is merged on top of the defaults, letting callers inject extra
 * headers (e.g. security headers) for responses produced outside a handler. @public
 */
export function htmlResponse(body: string | SafeHtml, status = 200, headers?: Record<string, string>): Response {
  return createHtmlResponse(body, { status, ...(headers ? { headers } : {}) });
}

/**
 * Constructs an HTML fragment `Response` (an HTMX partial) with `content-type: text/html`.
 * No DOCTYPE is added — fragments are swapped into an existing document. Accepts a `SafeHtml`
 * value or a string. Use `htmlResponse` for full documents. @public
 */
export function fragmentResponse(body: string | SafeHtml, status = 200, headers?: Record<string, string>): Response {
  return new Response(String(body), { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}
