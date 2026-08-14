import type { Middleware } from "@remix-run/fetch-router";
import { err, ok } from "../result/result";
import type { OriginResult } from "./types";

/** @internal */
export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/** Pure function: checks Origin/Referer headers against the allowed list. @public */
export function verifyOrigin(request: Request, allowedOrigins: string[]): OriginResult {
  const origin = request.headers.get("Origin");

  if (origin !== null) {
    if (allowedOrigins.includes(origin)) return ok();
    return err("disallowed");
  }

  const referer = request.headers.get("Referer");
  if (referer !== null) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refererOrigin)) return ok();
      return err("disallowed");
    } catch {
      return err("disallowed");
    }
  }

  return err("missing");
}

/** Middleware that rejects requests from disallowed or missing origins with a 403; safe methods are exempt. @public */
export function originGuard(allowedOrigins: string[]): Middleware {
  return async (context, next) => {
    if (SAFE_METHODS.has(context.method.toUpperCase())) return next();
    const result = verifyOrigin(context.request, allowedOrigins);
    if (!result.ok) return new Response("Forbidden", { status: 403 });
    return next();
  };
}
