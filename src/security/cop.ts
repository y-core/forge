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

  // Allowlist, not denylist: only `same-origin` and `none` carry no cross-origin initiator, so
  // `same-site` (any sibling subdomain) is rejected rather than treated as trusted.
  if (secFetchSite === "same-site") {
    return err("same-site");
  }
  if (secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return err("cross-site");
  }

  return ok();
}

/** Middleware that rejects cross-site mutation requests via Fetch Metadata with a 403. @public */
export function crossOriginProtection(options: CrossOriginProtectionOptions = {}): Middleware {
  return async (context, next) => {
    const result = checkCrossOriginProtection(context.request, options);
    if (!result.ok) {
      return new Response("Forbidden", { status: 403 });
    }
    return next();
  };
}

/** Combined cross-origin guard for mutating routes: Fetch Metadata and an Origin/Referer allowlist. @public */
export function originProtection<Bindings = Record<string, unknown>>(options: OriginProtectionOptions<Bindings>): Middleware {
  return async (context, next) => {
    if (SAFE_METHODS.has(context.method.toUpperCase())) return next();
    const cop = checkCrossOriginProtection(context.request, { allowMissingHeader: true });
    if (!cop.ok) return new Response("Forbidden", { status: 403 });
    // `Sec-Fetch-Site` is a veto, not a pass: a good value must not short-circuit the allowlist,
    // or a non-browser client skips it by forging one `Sec-Fetch-Site: same-origin` header.
    const allowed =
      typeof options.allowedOrigins === "function" ? options.allowedOrigins(getAppContext<Bindings>(context)) : options.allowedOrigins;
    const origin = verifyOrigin(context.request, allowed);
    if (origin.ok) return next();
    // Neither Origin nor Referer was sent: accept only the browser's Fetch-Metadata vouching,
    // since `Sec-Fetch-Site` is a forbidden header name that web content cannot set.
    if (origin.error === "missing" && context.request.headers.get("Sec-Fetch-Site") !== null) return next();
    return new Response("Forbidden", { status: 403 });
  };
}
