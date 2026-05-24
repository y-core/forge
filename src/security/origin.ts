import type { MiddlewareHandler } from "hono";
import type { OriginResult } from "./types";

/** Pure function: checks Origin/Referer headers against the allowed list. @public */
export function verifyOrigin(request: Request, allowedOrigins: string[]): OriginResult {
  const origin = request.headers.get("Origin");

  if (origin !== null) {
    if (allowedOrigins.includes(origin)) return { ok: true };
    return { ok: false, reason: "disallowed" };
  }

  const referer = request.headers.get("Referer");
  if (referer !== null) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refererOrigin)) return { ok: true };
      return { ok: false, reason: "disallowed" };
    } catch {
      return { ok: false, reason: "disallowed" };
    }
  }

  return { ok: false, reason: "missing" };
}

/** Middleware that rejects requests from disallowed or missing origins (403). @public */
export function originGuard(allowedOrigins: string[]): MiddlewareHandler {
  return async (c, next) => {
    const result = verifyOrigin(c.req.raw, allowedOrigins);
    if (!result.ok) {
      return c.text("Forbidden", 403);
    }
    return next();
  };
}
