import type { Middleware } from "@remix-run/fetch-router";
import { getAppContext } from "../context/types";
import { err, ok } from "../result/result";
import { SAFE_METHODS, verifyOrigin } from "./origin";
import type { CrossOriginProtectionOptions, CrossOriginResult, OriginProtectionOptions } from "./types";

/** Pure function: inspects Sec-Fetch-Site to detect cross-site mutations. @public */
export function checkCrossOriginProtection(request: Request, options: CrossOriginProtectionOptions = {}): CrossOriginResult {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return ok();
  }

  const secFetchSite = request.headers.get("Sec-Fetch-Site");

  if (secFetchSite === null) {
    if (options.allowMissingHeader) {
      return ok();
    }
    return err("missing-fetch-metadata");
  }

  if (secFetchSite === "cross-site") {
    return err("cross-site");
  }

  return ok();
}

/**
 * Middleware that rejects cross-site mutation requests via Fetch Metadata (403).
 *
 * @remarks
 * Tier: **Sec-Fetch-Site only** — the strictest guard, with no Origin/Referer fallback. When the
 * `Sec-Fetch-Site` header is absent it fails closed (unless `allowMissingHeader`). Prefer
 * {@link originProtection} as the recommended combined default; use {@link originGuard} for the
 * Origin/Referer-only tier.
 *
 * @public
 */
export function crossOriginProtection(options: CrossOriginProtectionOptions = {}): Middleware {
  return async (context, next) => {
    const result = checkCrossOriginProtection(context.request, options);
    if (!result.ok) {
      return new Response("Forbidden", { status: 403 });
    }
    return next();
  };
}

/**
 * Combined cross-origin guard for mutating routes.
 *
 * @remarks
 * Tier: **recommended combined default** — Sec-Fetch-Site with an Origin/Referer fallback.
 * Safe methods (GET/HEAD/OPTIONS/TRACE) are exempt first, matching {@link originGuard}. For present
 * `Sec-Fetch-Site` the Fetch-Metadata check ({@link crossOriginProtection}, `allowMissingHeader`)
 * is authoritative; when the header is absent it falls back to an Origin/Referer allowlist check.
 * `allowedOrigins` is a static list or a per-request resolver over the app context. Use
 * {@link crossOriginProtection} for the stricter Sec-Fetch-Site-only tier (no fallback), or
 * {@link originGuard} for the Origin/Referer-only tier.
 *
 * @public
 */
export function originProtection<Bindings = Record<string, unknown>>(options: OriginProtectionOptions<Bindings>): Middleware {
  return async (context, next) => {
    if (SAFE_METHODS.has(context.method.toUpperCase())) return next(); // safe method → exempt
    const cop = checkCrossOriginProtection(context.request, { allowMissingHeader: true });
    if (!cop.ok) return new Response("Forbidden", { status: 403 }); // cross-site → reject
    if (context.request.headers.get("Sec-Fetch-Site") !== null) return next(); // COP authoritative
    const allowed =
      typeof options.allowedOrigins === "function" ? options.allowedOrigins(getAppContext<Bindings>(context)) : options.allowedOrigins;
    if (!verifyOrigin(context.request, allowed).ok) return new Response("Forbidden", { status: 403 });
    return next();
  };
}
