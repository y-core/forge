/**
 * Constructs a `Response` with `content-type: text/html`.
 * Use outside Hono handlers (error pages, fragments); prefer `c.html()` inside handlers.
 * The optional `headers` map is merged on top of `content-type`, allowing callers to
 * inject security headers (e.g. from `makeSecurityHeaders`) for out-of-handler responses.
 * @public
 */
export function htmlResponse(
  html: string,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}
