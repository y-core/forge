import type { Middleware } from "@remix-run/fetch-router";

import { ContentType } from "../http/headers";

const MEDIA_TYPE = /^[!#$%&'*+.^_`|~\w-]+\/[!#$%&'*+.^_`|~\w-]+$/;

/** Middleware that rejects requests whose Content-Type is not a form encoding (415). @public */
export function requireFormContentType(): Middleware {
  return async (context, next) => {
    const header = context.request.headers.get("content-type") ?? "";
    // Media types are case-insensitive (RFC 9110 §8.3.1); lowercase before comparison.
    const base = (ContentType.from(header).mediaType ?? "").toLowerCase();
    const wellFormed = MEDIA_TYPE.test((header.split(";")[0] ?? "").trim());
    if (!wellFormed || (base !== "application/x-www-form-urlencoded" && base !== "multipart/form-data")) {
      return new Response("Unsupported Media Type", { status: 415 });
    }
    return next();
  };
}
