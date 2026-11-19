import type { Middleware } from "@remix-run/fetch-router";

import { mediaTypeEssence } from "../http/media-type";

/** Middleware that rejects requests whose Content-Type is not a form encoding (415). @public */
export function requireFormContentType(): Middleware {
  return async (context, next) => {
    const essence = mediaTypeEssence(context.request.headers.get("content-type") ?? "");
    if (essence !== "application/x-www-form-urlencoded" && essence !== "multipart/form-data") {
      return new Response("Unsupported Media Type", { status: 415 });
    }
    return next();
  };
}
