import type { Middleware } from "@remix-run/fetch-router";
import { getAppContext } from "../context/types";
import { SAFE_METHODS, verifyOrigin } from "./origin";
import type { CopResult, CrossOriginProtectionOptions, OriginProtectionOptions } from "./types";

/** Pure function: inspects Sec-Fetch-Site to detect cross-site mutations. @public */
export function checkCrossOriginProtection(request: Request, options: CrossOriginProtectionOptions = {}): CopResult {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return { ok: true };
  }

  const secFetchSite = request.headers.get("Sec-Fetch-Site");

  if (secFetchSite === null) {
    if (options.allowMissingHeader) {
      return { ok: true };
    }
    return { ok: false, reason: "missing-fetch-metadata" };
  }

  if (secFetchSite === "cross-site") {
    return { ok: false, reason: "cross-site" };
  }

  return { ok: true };
}

/** Middleware that rejects cross-site mutation requests via Fetch Metadata (403). @public */
export function crossOriginProtection(options: CrossOriginProtectionOptions = {}): Middleware {
  return async (context, next) => {
    const result = checkCrossOriginProtection(context.request, options);
    if (!result.ok) {
      return new Response("Forbidden", { status: 403 });
    }
    return next();
  };
}

/** Combined cross-origin guard for mutating routes: Fetch-Metadata (`crossOriginProtection`,
 *  `allowMissingHeader`) is authoritative when `Sec-Fetch-Site` is present; when the header is
 *  absent it falls back to an Origin/Referer allowlist check. Safe methods are always exempt.
 *  `allowedOrigins` is a static list or a per-request resolver over the app context. @public */
export function originProtection<Bindings = Record<string, unknown>>(options: OriginProtectionOptions<Bindings>): Middleware {
  return async (context, next) => {
    const cop = checkCrossOriginProtection(context.request, { allowMissingHeader: true });
    if (!cop.ok) return new Response("Forbidden", { status: 403 }); // cross-site → reject
    if (context.request.headers.get("Sec-Fetch-Site") !== null) return next(); // COP authoritative
    if (SAFE_METHODS.has(context.method.toUpperCase())) return next();
    const allowed =
      typeof options.allowedOrigins === "function" ? options.allowedOrigins(getAppContext<Bindings>(context)) : options.allowedOrigins;
    if (!verifyOrigin(context.request, allowed).ok) return new Response("Forbidden", { status: 403 });
    return next();
  };
}
