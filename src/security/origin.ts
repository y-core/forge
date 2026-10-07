import type { Middleware } from "@remix-run/fetch-router";

import { isWebSocketUpgrade } from "../http/upgrade";
import { err, ok } from "../result/result";
import type { OriginResult } from "./types";

/** @internal */
export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

// A WebSocket handshake is a GET that opens a cookie-bearing channel, so it is never exempt.
/** True when an origin guard lets the request through without looking at it. @internal */
export function isExemptFromOriginCheck(request: Request): boolean {
  return SAFE_METHODS.has(request.method.toUpperCase()) && !isWebSocketUpgrade(request);
}

/** Pure function: checks Origin/Referer headers against the allowed list. @public */
export function verifyOrigin(request: Request, allowedOrigins: string[]): OriginResult {
  const origin = request.headers.get("Origin");

  if (origin !== null) {
    if (allowedOrigins.includes(origin)) return ok();
    return err("disallowed");
  }

  // A browser always sends Origin on a WebSocket handshake (RFC 6455 §4.1), so a Referer cannot stand in for it.
  const referer = isWebSocketUpgrade(request) ? null : request.headers.get("Referer");
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

/** Middleware that 403s a disallowed or missing origin; safe methods are exempt unless they upgrade to a WebSocket. @public */
export function originGuard(allowedOrigins: string[]): Middleware {
  return async (context, next) => {
    if (isExemptFromOriginCheck(context.request)) return next();
    const result = verifyOrigin(context.request, allowedOrigins);
    if (!result.ok) return new Response("Forbidden", { status: 403 });
    return next();
  };
}
