import type { RequestContext } from "@remix-run/fetch-router";
import { FORM_MAX_BYTES_DEFAULT } from "./config";
import type { ParseFormDataOptions, ReadonlyFormData } from "./types";

const cache = new WeakMap<Request, Promise<ReadonlyFormData>>();

/** Builds a 413 error carrying an HTTP status, surfaced by callers as a 413 response. */
function tooLarge(maxBytes: number): Error & { status: number } {
  return Object.assign(new Error(`Form body exceeds ${maxBytes} byte limit`), { status: 413 });
}

/**
 * Pipes the body through a counting transform that errors once the running total exceeds
 * `maxBytes`, then parses via `Response.formData()`. This enforces the budget even when the
 * `Content-Length` header is absent or lies (chunked transfer), closing the header-only bypass.
 */
function parseWithByteLimit(req: Request, maxBytes: number): Promise<ReadonlyFormData> {
  // No body to meter (e.g. GET) — parse directly.
  if (!req.body) return req.formData();
  let seen = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(tooLarge(maxBytes));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  // A `Response` (not a `Request`) wraps the metered stream so no `duplex` option is needed; it
  // inherits the original content-type so multipart and urlencoded bodies both parse correctly.
  return new Response(req.body.pipeThrough(counter), { headers: req.headers }).formData();
}

/**
 * Memoized form-data parsing. The WeakMap cache lets CSRF validation and
 * action handling share a single body parse without double-consuming the stream.
 * Rejects oversized bodies via a Content-Length fast-path AND a streaming byte cap. @public
 */
export function parseFormData(
  // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for form-data parsing
  context: RequestContext<any, any>,
  options: ParseFormDataOptions = {},
): Promise<ReadonlyFormData> {
  const req = context.request;
  let cached = cache.get(req);
  if (!cached) {
    const maxBytes = options.maxBytes ?? FORM_MAX_BYTES_DEFAULT;
    const contentLength = req.headers.get("content-length");
    if (contentLength !== null) {
      const length = Number(contentLength);
      if (Number.isFinite(length) && length > maxBytes) {
        cached = Promise.reject(tooLarge(maxBytes));
        // Pre-attach a no-op catch so the rejection can never surface as an unhandled rejection
        // if a caller reads the cache entry without awaiting it.
        cached.catch(() => {});
        cache.set(req, cached);
        return cached;
      }
    }
    cached = parseWithByteLimit(req, maxBytes);
    cache.set(req, cached);
  }
  return cached;
}
