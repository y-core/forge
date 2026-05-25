/** Constructs a plain `Response` with `content-type: text/html`. Use outside Hono handlers; prefer `c.html()` inside them. @public */
export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
