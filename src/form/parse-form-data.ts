import type { Context } from "hono";
import type { ReadonlyFormData } from "./types";

const cache = new WeakMap<Request, Promise<ReadonlyFormData>>();

/**
 * Memoized form-data parsing. The WeakMap cache lets CSRF validation and
 * action handling share a single body parse without double-consuming the stream.
 * @public
 */
export function parseFormData(c: Context): Promise<ReadonlyFormData> {
  const req = c.req.raw;
  let cached = cache.get(req);
  if (!cached) {
    cached = c.req.formData();
    cache.set(req, cached);
  }
  return cached;
}
