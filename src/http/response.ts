import type { SafeHtml } from "@remix-run/html-template";
import { createHtmlResponse } from "@remix-run/response/html";

/** Re-export of `@remix-run/response`'s redirect helper (also aliased as `redirect`). @public */
export { createRedirectResponse, createRedirectResponse as redirect } from "@remix-run/response/redirect";

/**
 * Constructs a full-page HTML `Response`, guaranteeing a leading `<!DOCTYPE html>` and a
 * `content-type: text/html` header. Accepts a `SafeHtml` value (e.g. from `renderToString`)
 * or a string. For HTMX partials that must NOT carry a DOCTYPE, use `fragmentResponse`.
 *
 * The optional `headers` map is merged. The `content-type` is fixed to `text/html`; passing a
 * `content-type` key (case-insensitive) throws.
 *
 * @example
 * ```typescript
 * const page = htmlResponse(await renderToString(<Home />));
 * // Custom headers merge:
 * const cached = htmlResponse(html, 200, { "cache-control": "public, max-age=300" });
 * ```
 * @public
 */
export function htmlResponse(body: string | SafeHtml, status = 200, headers?: Record<string, string>): Response {
  if (headers && Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    throw new Error("htmlResponse: content-type is fixed for HTML responses — remove it from headers");
  }
  return createHtmlResponse(body, { status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/**
 * Constructs an HTML fragment `Response` (an HTMX partial) with `content-type: text/html`.
 * No DOCTYPE is added — fragments are swapped into an existing document. Accepts a `SafeHtml`
 * value or a string. Use `htmlResponse` for full documents. As with `htmlResponse`, the
 * optional `headers` map is merged; the `content-type` is fixed to `text/html` and passing a
 * `content-type` key (case-insensitive) throws.
 *
 * @example
 * ```typescript
 * return fragmentResponse(renderSuccess("Saved."));            // 200 partial
 * return fragmentResponse(renderError("Not allowed."), 403);   // error partial with status
 * ```
 * @public
 */
export function fragmentResponse(body: string | SafeHtml, status = 200, headers?: Record<string, string>): Response {
  if (headers && Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    throw new Error("fragmentResponse: content-type is fixed for HTML responses — remove it from headers");
  }
  return new Response(String(body), { status, headers: { ...(headers ?? {}), "content-type": "text/html; charset=utf-8" } });
}
