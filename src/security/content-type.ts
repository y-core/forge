import type { Middleware } from "@remix-run/fetch-router";

/** Middleware that rejects requests whose Content-Type is not a form encoding (415). @public */
export function requireFormContentType(): Middleware {
  return async (context, next) => {
    const ct = context.request.headers.get("content-type") ?? "";
    // Media types are case-insensitive (RFC 9110 §8.3.1); lowercase before comparison.
    const base = (ct.split(";")[0] ?? "").trim().toLowerCase();
    if (base !== "application/x-www-form-urlencoded" && base !== "multipart/form-data") {
      return new Response("Unsupported Media Type", { status: 415 });
    }
    return next();
  };
}
