import type { Middleware } from "@remix-run/fetch-router";

import { mediaTypeEssence } from "../http/media-type";
import { isSafeHttpMethod } from "../http/method";

/** Reports whether a request method is safe by RFC 9110 §9.2.1 — GET, HEAD, OPTIONS or TRACE — compared case-insensitively. @public */
export function isSafeMethod(method: string): boolean {
  return isSafeHttpMethod(method);
}

/** Middleware that passes the {@link isSafeMethod} methods and answers 415 to any other request whose Content-Type is not a form encoding. @public */
export function requireFormContentType(): Middleware {
  return async (context, next) => {
    if (isSafeMethod(context.request.method)) return next();
    const essence = mediaTypeEssence(context.request.headers.get("content-type") ?? "");
    if (essence !== "application/x-www-form-urlencoded" && essence !== "multipart/form-data") {
      return new Response("Unsupported Media Type", { status: 415 });
    }
    return next();
  };
}
