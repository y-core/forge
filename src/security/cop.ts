import type { Middleware } from "@remix-run/fetch-router";
import { SAFE_METHODS } from "./origin";
import type { CopResult, CrossOriginProtectionOptions } from "./types";

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
