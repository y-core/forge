import type { Context } from "hono";
import { FORM_MAX_BYTES_DEFAULT } from "./config";
import type { ReadonlyFormData } from "./types";

const cache = new WeakMap<Request, Promise<ReadonlyFormData>>();

export interface ParseFormDataOptions {
  /** Maximum allowed Content-Length in bytes. Requests exceeding this are rejected with a 413 Response. Defaults to 100 KB. */
  maxBytes?: number;
}

/**
 * Memoized form-data parsing. The WeakMap cache lets CSRF validation and
 * action handling share a single body parse without double-consuming the stream.
 * Rejects oversized bodies based on Content-Length before reading. @public
 */
export function parseFormData(
  c: Context,
  options: ParseFormDataOptions = {},
): Promise<ReadonlyFormData> {
  const req = c.req.raw;
  let cached = cache.get(req);
  if (!cached) {
    const maxBytes = options.maxBytes ?? FORM_MAX_BYTES_DEFAULT;
    const contentLength = req.headers.get("content-length");
    if (contentLength !== null) {
      const length = Number(contentLength);
      if (Number.isFinite(length) && length > maxBytes) {
        cached = Promise.reject(
          Object.assign(new Error(`Form body exceeds ${maxBytes} byte limit`), { status: 413 }),
        );
        cache.set(req, cached);
        return cached;
      }
    }
    cached = c.req.formData();
    cache.set(req, cached);
  }
  return cached;
}
