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

  // Allowlist, not denylist. `same-origin` and `none` (a direct navigation or a user-initiated
  // load) are the only values that carry no cross-origin initiator. Everything else — notably
  // `same-site`, which any sibling subdomain produces — is a mutation driven from somewhere the
  // app does not control, so it is rejected. This matches Go's `http.CrossOriginProtection`.
  if (secFetchSite === "same-site") {
    return err("same-site");
  }
  if (secFetchSite !== "same-origin" && secFetchSite !== "none") {
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
 * Tier: **recommended combined default** — Fetch Metadata *and* an Origin/Referer allowlist, both
 * applied. Safe methods (GET/HEAD/OPTIONS/TRACE) are exempt first, matching {@link originGuard}.
 *
 * `Sec-Fetch-Site` acts as a **veto, not a pass**. A value other than `same-origin`/`none` rejects
 * outright, but a good value does *not* short-circuit the allowlist: `allowedOrigins` is consulted
 * on every mutating request that carries an `Origin` or `Referer`. Only when both of those are
 * absent does the guard fall back to the browser's Fetch-Metadata vouching — `Sec-Fetch-Site` is a
 * forbidden header name, so web content cannot set it and a `same-origin` value there was written
 * by the browser itself. With nothing to go on at all, it fails closed.
 *
 * Consequence: **the app's own origin must appear in `allowedOrigins`**, or its own same-origin
 * mutations are rejected. That is deliberate, fail-closed, and consistent with {@link originGuard}.
 * Without it a non-browser client could skip the allowlist entirely by sending one forged
 * `Sec-Fetch-Site: same-origin` header.
 *
 * `allowedOrigins` is a static list or a per-request resolver over the app context. Use
 * {@link crossOriginProtection} for the Sec-Fetch-Site-only tier (no allowlist), or
 * {@link originGuard} for the Origin/Referer-only tier.
 *
 * @public
 */
export function originProtection<Bindings = Record<string, unknown>>(options: OriginProtectionOptions<Bindings>): Middleware {
  return async (context, next) => {
    if (SAFE_METHODS.has(context.method.toUpperCase())) return next(); // safe method → exempt
    const cop = checkCrossOriginProtection(context.request, { allowMissingHeader: true });
    if (!cop.ok) return new Response("Forbidden", { status: 403 }); // not same-origin/none → reject
    const allowed =
      typeof options.allowedOrigins === "function" ? options.allowedOrigins(getAppContext<Bindings>(context)) : options.allowedOrigins;
    const origin = verifyOrigin(context.request, allowed);
    if (origin.ok) return next();
    // Neither Origin nor Referer was sent. Accept only if the browser vouched via Fetch Metadata;
    // otherwise there is no evidence of provenance at all, so fail closed.
    if (origin.error === "missing" && context.request.headers.get("Sec-Fetch-Site") !== null) return next();
    return new Response("Forbidden", { status: 403 });
  };
}
