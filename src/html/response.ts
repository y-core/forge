// Context-free HTML response for use outside Hono handlers (action pipelines, standalone factories).
// Within a handler, prefer c.html() instead.
export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
